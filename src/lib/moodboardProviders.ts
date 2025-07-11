// Image providers for the mood board feature. Each one is a self-contained
// search function that returns a uniform shape, so the route + UI don't
// have to know which service answered. Add a new provider here, the
// rest of the app picks it up automatically via the round-robin in
// the search route.

export type ProviderId = 'unsplash' | 'pexels' | 'openverse' | 'europeana' | 'tumblr' | 'met';

export type MoodBoardPhoto = {
  id: string;
  provider: ProviderId;
  width: number;
  height: number;
  alt: string;
  thumb: string;       // ~200–400px, for the grid
  regular: string;     // ~1080px, used as the source we copy to R2
  full: string;        // largest available
  // Unsplash requires us to ping this URL when the photo is "used" so
  // photographers get credit. Other providers don't have this concept.
  downloadEndpoint?: string;
  attribution: {
    name: string;
    profileUrl: string;
  };
};

export type ProviderFn = (query: string, page: number) => Promise<MoodBoardPhoto[]>;

// ── Relevance helpers ──────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','of','to','for','with','and','or','in','on','at','by','from',
  'is','it','as','be','this','that','these','those','my','your','our',
]);

/** Extract meaningful tokens from a query: lowercase, length >= 3, not a stopword. */
function queryTokens(q: string): string[] {
  return q.toLowerCase().split(/[\s\-_/]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Drop items whose haystack text shares zero meaningful tokens with the query.
 * Used for OpenVerse / Europeana which match aggressively on tags and return
 * tangentially-related material. Safety: if the filter would leave fewer
 * than `minKeep` items, return the original list — better some loosely-related
 * results than an empty grid.
 */
function relevanceFilter<T>(
  items: T[],
  query: string,
  getHaystack: (item: T) => string,
  minKeep = 8
): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return items;
  const matched = items.filter((it) => {
    const hay = getHaystack(it).toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  return matched.length >= minKeep ? matched : items;
}

// ── Unsplash ───────────────────────────────────────────────────────────────
// Curated photography, designerly vibe. Demo tier 50 req/hr.
async function unsplashSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('Unsplash not configured');

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '20');
  url.searchParams.set('orientation', 'squarish');
  url.searchParams.set('content_filter', 'high');

  const res = await fetch(url, {
    headers: { 'Accept-Version': 'v1', Authorization: `Client-ID ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Unsplash ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((p: any): MoodBoardPhoto => ({
    id: `unsplash:${p.id}`,
    provider: 'unsplash',
    width: p.width,
    height: p.height,
    alt: p.alt_description ?? p.description ?? '',
    thumb: p.urls.thumb,
    regular: p.urls.regular,
    full: p.urls.full,
    downloadEndpoint: p.links.download_location,
    attribution: {
      name: p.user?.name ?? 'Unknown',
      profileUrl: p.user?.links?.html ?? 'https://unsplash.com',
    },
  }));
}

// ── Pexels ─────────────────────────────────────────────────────────────────
// Stockier but well-curated; instant API key, 200 req/hr free.
async function pexelsSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('Pexels not configured');

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '20');
  url.searchParams.set('orientation', 'square');
  url.searchParams.set('size', 'large'); // drop tiny thumbnail-grade originals
  url.searchParams.set('locale', 'en-US');

  const res = await fetch(url, {
    headers: { Authorization: key },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();

  return (data.photos ?? []).map((p: any): MoodBoardPhoto => ({
    id: `pexels:${p.id}`,
    provider: 'pexels',
    width: p.width,
    height: p.height,
    alt: p.alt ?? '',
    thumb: p.src.tiny ?? p.src.small,
    regular: p.src.medium ?? p.src.large,
    full: p.src.original,
    attribution: {
      name: p.photographer ?? 'Unknown',
      profileUrl: p.photographer_url ?? 'https://www.pexels.com',
    },
  }));
}

// ── OpenVerse ──────────────────────────────────────────────────────────────
// Wikimedia's CC-licensed image aggregator — pulls from Flickr Commons,
// Wikimedia Commons, museums. ~700M images. No key required (anonymous
// rate limit is modest but plenty for personal use). Best universal
// fallback because it handles modern subjects (interior design, fashion,
// product photography) that art-museum APIs can't.
async function openverseSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(page));
  // Over-fetch so the post-filter still leaves us a healthy grid.
  url.searchParams.set('page_size', '40');
  url.searchParams.set('mature', 'false');
  // Drop diagrams, vector clipart, and digitized text. Photographs +
  // digitized artwork is the sweet spot for mood boards.
  url.searchParams.set('category', 'photograph,digitized_artwork');
  // Skip pinterest-tall and panoramic crops that look bad in a square grid.
  url.searchParams.set('aspect_ratio', 'square,wide,tall');
  // Skip thumbnail-only entries (some Commons items have 100px scans).
  url.searchParams.set('size', 'medium,large');
  // JPG/PNG only — SVG is almost always a diagram or icon, not a mood image.
  url.searchParams.set('extension', 'jpg,jpeg,png');

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`OpenVerse ${res.status}`);
  const data = await res.json();

  const mapped: MoodBoardPhoto[] = (data.results ?? [])
    .filter((p: any) => p.thumbnail && p.url)
    .map((p: any): MoodBoardPhoto => ({
      id: `openverse:${p.id}`,
      provider: 'openverse',
      width: p.width || 0,
      height: p.height || 0,
      alt: p.title ?? '',
      thumb: p.thumbnail,
      regular: p.url,
      full: p.url,
      attribution: {
        name: p.creator || p.source || 'Unknown',
        profileUrl: p.foreign_landing_url || p.creator_url || 'https://openverse.org',
      },
    }));

  // Post-filter: drop items whose title shares no meaningful tokens with the
  // query. OpenVerse matches aggressively on Flickr/Wikimedia tags so
  // results can drift far off-topic; the title is the most reliable signal.
  return relevanceFilter(mapped, query, (p) => p.alt).slice(0, 20);
}

// ── Europeana ──────────────────────────────────────────────────────────────
// 50M+ items from European museums, libraries, and archives. Strongest
// on fashion history, vintage advertising, design objects, posters,
// architectural photography — basically the curated cultural-heritage
// material that gets pinned to Are.na boards. Free instant key.
async function europeanaSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const key = process.env.EUROPEANA_API_KEY;
  if (!key) throw new Error('Europeana not configured');

  const url = new URL('https://api.europeana.eu/record/v2/search.json');
  url.searchParams.set('wskey', key);
  url.searchParams.set('query', query);
  // Over-fetch so the post-filter still leaves a healthy grid.
  url.searchParams.set('rows', '40');
  url.searchParams.set('start', String((page - 1) * 20 + 1));
  url.searchParams.set('media', 'true');
  url.searchParams.set('reusability', 'open'); // CC0/CC-BY only — safe for embed
  url.searchParams.set('sort', 'score+desc'); // explicit relevance sort
  url.searchParams.set('profile', 'rich');    // fuller metadata for filtering
  // Multiple qf filters: image type, color (drops B&W document scans),
  // JPEG mime (drops PDFs/TIFFs), and large-enough size (drops postage-stamp
  // thumbnails). Europeana joins repeated qf params with AND.
  url.searchParams.append('qf', 'TYPE:IMAGE');
  url.searchParams.append('qf', 'IMAGE_COLOUR:true');
  url.searchParams.append('qf', 'MIME_TYPE:image/jpeg');
  url.searchParams.append('qf', 'IMAGE_SIZE:(large OR extra_large)');

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Europeana ${res.status}`);
  const data = await res.json();

  const firstString = (v: any): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');

  const mapped: MoodBoardPhoto[] = (data.items ?? [])
    .filter((it: any) => it.edmPreview?.[0])
    .map((it: any): MoodBoardPhoto => {
      // Combine title + description for the haystack so we catch records
      // where the title is just a date/accession number (common in archives).
      const title = firstString(it.title);
      const desc = firstString(it.dcDescription);
      return {
        id: `europeana:${String(it.id).replace(/\//g, '-')}`,
        provider: 'europeana',
        width: 0,
        height: 0,
        alt: title || desc,
        thumb: it.edmPreview[0],
        regular: firstString(it.edmIsShownBy) || it.edmPreview[0],
        full: firstString(it.edmIsShownBy) || it.edmPreview[0],
        attribution: {
          name: firstString(it.dcCreator) || firstString(it.dataProvider) || 'Europeana',
          profileUrl: it.guid || 'https://www.europeana.eu',
        },
        // Stash the description for the relevance filter without polluting
        // the public type — cast and read it back below.
        _haystack: `${title} ${desc}`,
      } as any;
    });

  return relevanceFilter(mapped, query, (p) => (p as any)._haystack ?? p.alt)
    .map((p) => { delete (p as any)._haystack; return p; })
    .slice(0, 20);
}

// ── Tumblr ─────────────────────────────────────────────────────────────────
// Tagged-post search via the public v2 API. The tagged endpoint doesn't
// support type filtering server-side or integer pagination — it cursors
// on a `before` timestamp and caps returns around ~20. To keep the
// provider interface (query, page) clean we serve only page 1; pages 2+
// return empty which triggers fallthrough in the search route.
//
// Aesthetic: tumblr posts are the curated weird-internet-mood-board stuff
// (fashion, design references, vintage, art) — different vibe from stock.
async function tumblrSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const key = process.env.TUMBLR_API_KEY;
  if (!key) throw new Error('Tumblr not configured');
  if (page > 1) return [];

  // Tumblr expects tags lowercased and space-delimited; their UI tag for
  // "mid-century-modern" lives at both that slug and the loose form.
  const tag = query.trim().toLowerCase();

  const url = new URL('https://api.tumblr.com/v2/tagged');
  url.searchParams.set('tag', tag);
  url.searchParams.set('api_key', key);
  url.searchParams.set('limit', '20');

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Tumblr ${res.status}`);
  const data = await res.json();

  // Each photo post has a `photos[]` array — flatten so a multi-photo
  // post contributes multiple grid cells. Tag-filtered posts are already
  // topically relevant (the tagged endpoint matches the tag exactly), so
  // we don't run the alt-text relevance filter on Tumblr results.
  const photoPosts = (data.response ?? []).filter(
    (p: any) => p.type === 'photo' && Array.isArray(p.photos) && p.photos.length > 0
  );

  const mapped: MoodBoardPhoto[] = photoPosts.flatMap((p: any) =>
    p.photos
      .filter((photo: any) => photo.original_size?.url)
      .map((photo: any, idx: number): MoodBoardPhoto => {
        // Pick a thumbnail in the 200–500px range so the grid loads fast;
        // alt_sizes is sorted largest-first, so walk and pick.
        const altSizes: any[] = photo.alt_sizes ?? [];
        const thumb =
          altSizes.find((s) => s.width >= 200 && s.width <= 500)?.url
          ?? altSizes[altSizes.length - 1]?.url
          ?? photo.original_size.url;
        return {
          id: `tumblr:${p.id}-${idx}`,
          provider: 'tumblr',
          width: photo.original_size.width || 0,
          height: photo.original_size.height || 0,
          alt: p.summary || (p.tags ?? []).join(', '),
          thumb,
          regular: photo.original_size.url,
          full: photo.original_size.url,
          attribution: {
            name: p.blog_name || 'Tumblr',
            profileUrl: p.post_url || `https://${p.blog_name}.tumblr.com`,
          },
        };
      })
  );

  return mapped.slice(0, 20);
}

// ── Public registry ────────────────────────────────────────────────────────

// Provider order is the rotation order — round-robin picks the next one
// in this array per request. Unconfigured providers (no API key) drop
// out automatically so the rotation collapses to whatever's available.
//
// The Met is intentionally OFF by default: its narrow fine-art vocabulary
// returns false positives for modern queries like "interior design"
// (it'll match "interior" in an 18th-century cabinet record). Re-add it
// here if a future toggle lets the user opt in for fine-art queries.
const ALL_PROVIDERS: Array<{ id: ProviderId; configured: () => boolean; fn: ProviderFn }> = [
  { id: 'unsplash',  configured: () => !!process.env.UNSPLASH_ACCESS_KEY, fn: unsplashSearch },
  { id: 'pexels',    configured: () => !!process.env.PEXELS_API_KEY,      fn: pexelsSearch },
  { id: 'openverse', configured: () => true,                              fn: openverseSearch },
  { id: 'europeana', configured: () => !!process.env.EUROPEANA_API_KEY,   fn: europeanaSearch },
  { id: 'tumblr',    configured: () => !!process.env.TUMBLR_API_KEY,      fn: tumblrSearch },
];

export function configuredProviders() {
  return ALL_PROVIDERS.filter((p) => p.configured());
}

export function getProviderById(id: string): { id: ProviderId; fn: ProviderFn } | null {
  const found = configuredProviders().find((p) => p.id === id);
  return found ? { id: found.id, fn: found.fn } : null;
}

// Round-robin state — module-level counter. Survives within a single
// serverless invocation worker; cold starts reset it. That's fine because
// the rotation is for variety, not exact fairness.
let cursor = 0;

/**
 * Build a provider chain for a request:
 * - If `preferred` is given (Load More with sticky provider), put it first
 *   and follow with remaining configured providers as fallback.
 * - Otherwise (fresh search), use round-robin to pick a starting point.
 * - In both cases, providers in `excluded` are filtered out entirely.
 */
export function buildProviderChain(
  excluded: Set<string>,
  preferred?: string
): Array<{ id: ProviderId; fn: ProviderFn }> {
  const remaining = configuredProviders().filter((p) => !excluded.has(p.id));
  if (remaining.length === 0) return [];

  if (preferred) {
    const head = remaining.find((p) => p.id === preferred);
    if (head) {
      const tail = remaining.filter((p) => p.id !== preferred);
      return [head, ...tail].map(({ id, fn }) => ({ id, fn }));
    }
    // Preferred isn't configured/available — fall through to fresh-pick logic
  }

  // Fresh round-robin pick from the remaining set
  const start = cursor++ % remaining.length;
  const ordered = [...remaining.slice(start), ...remaining.slice(0, start)];
  return ordered.map(({ id, fn }) => ({ id, fn }));
}
