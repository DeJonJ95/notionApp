// Image providers for the mood board feature. Each one is a self-contained
// search function that returns a uniform shape, so the route + UI don't
// have to know which service answered. Add a new provider here, the
// rest of the app picks it up automatically via the round-robin in
// the search route.

export type ProviderId = 'unsplash' | 'pexels' | 'openverse' | 'europeana' | 'tumblr' | 'google' | 'met';

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

  // The /v2/tagged endpoint only matches ONE literal tag. So for a query
  // like "mens fashion streetwear", searching that as a single tag returns
  // almost nothing — that exact multi-word tag isn't in use. Tumblr's
  // website search hits multiple tags + post bodies, but the API
  // equivalent was deprecated.
  //
  // Workaround: split the query into significant words, fetch each as
  // its own tag in parallel, dedupe by post ID, then score posts higher
  // when their tag list overlaps MORE of the query's words. End result
  // is much closer to what the user sees on tumblr.com/search/<query>.
  const verbatim = query.trim().toLowerCase();
  const tokens = queryTokens(verbatim); // already strips stopwords + short words
  // Always try the verbatim query first (some multi-word tags do exist —
  // "mid-century modern" is a real tag) then each significant token.
  // Cap parallel API calls at 5 to keep us well under Tumblr's rate budget.
  const tags = Array.from(new Set([verbatim, ...tokens])).slice(0, 5);

  const fetchTag = async (tag: string): Promise<any[]> => {
    const url = new URL('https://api.tumblr.com/v2/tagged');
    url.searchParams.set('tag', tag);
    url.searchParams.set('api_key', key);
    url.searchParams.set('limit', '20');
    try {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.response) ? data.response : [];
    } catch {
      return [];
    }
  };

  const batches = await Promise.all(tags.map(fetchTag));
  const photoPosts: any[] = [];
  const seen = new Set<string>();
  for (const batch of batches) {
    for (const post of batch) {
      if (post.type !== 'photo' || !Array.isArray(post.photos) || post.photos.length === 0) continue;
      const postId = String(post.id);
      if (seen.has(postId)) continue;
      seen.add(postId);
      photoPosts.push(post);
    }
  }

  // Score by tag-overlap: posts whose tags contain MORE of the query's
  // tokens rank higher. So a post tagged ["mens fashion", "streetwear",
  // "ootd"] scores higher than one tagged just ["fashion"] for a
  // "mens fashion streetwear" query — that's exactly the relevance
  // Tumblr's website search applies and we're approximating here.
  type Scored = { post: any; score: number };
  const scored: Scored[] = photoPosts.map((post) => {
    const postTags: string[] = (post.tags ?? []).map((t: string) => String(t).toLowerCase());
    let score = 0;
    for (const token of tokens) {
      if (postTags.some((t) => t === token || t.includes(token))) score++;
    }
    return { post, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const mapped: MoodBoardPhoto[] = scored.flatMap(({ post: p }) =>
    p.photos
      .filter((photo: any) => photo.original_size?.url)
      .map((photo: any, idx: number): MoodBoardPhoto => {
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

// ── Google Programmable Search (Custom Search Engine) ─────────────────────
// Google CSE image search. The strongest free-ish answer for niche
// fashion / aesthetic queries because Google indexes Pinterest itself,
// so a "japanese baggy denim" query surfaces actual Pinterest pins +
// Tumblr posts + fashion blogs that no museum API can match.
//
// Free tier: 100 queries/day, then $5 per 1000. We never copy bytes
// to R2 from Google results — the underlying images come from arbitrary
// third-party hosts with unknown licenses. Instead the save route returns
// the source URL as-is and we hotlink into the note. Trade-off: the
// note breaks if the source ever removes the image, but copyright stays
// clean.
async function googleSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ENGINE_ID;
  if (!key || !cx) throw new Error('Google CSE not configured');

  // Google caps `num` at 10 per call. To match the other providers'
  // 20-per-page UX we'd fan out two calls, but that doubles quota use.
  // We keep it at 10 and let the sticky-provider machinery hand off to
  // the next provider after one page — saves the daily quota for queries
  // where Google actually wins.
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', '10');
  url.searchParams.set('safe', 'active');
  url.searchParams.set('imgSize', 'large');
  // 1-indexed offset: page 1 → start=1, page 2 → start=11, etc.
  url.searchParams.set('start', String((page - 1) * 10 + 1));

  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) {
    // 429 (quota) and 403 are common — let the chain fall through.
    throw new Error(`Google CSE ${res.status}`);
  }
  const data = await res.json();

  const items: any[] = Array.isArray(data.items) ? data.items : [];
  return items
    .filter((it) => it.link && it.image?.thumbnailLink)
    .map((it, idx): MoodBoardPhoto => ({
      // Use the underlying host + index for the ID so duplicates across
      // pages don't collide (Google can re-rank between calls).
      id: `google:${page}-${idx}-${hash32(it.link)}`,
      provider: 'google',
      width: it.image.width ?? 0,
      height: it.image.height ?? 0,
      alt: it.title ?? it.snippet ?? '',
      thumb: it.image.thumbnailLink,
      regular: it.link,
      full: it.link,
      attribution: {
        // displayLink is the bare host (e.g. "www.pinterest.com" or
        // "fashionweekdaily.com") — useful credit signal in the overlay.
        name: it.displayLink || 'web',
        // contextLink points to the page where the image lives, which
        // is the right destination for clicks on the photographer name.
        profileUrl: it.image.contextLink || it.link,
      },
    }));
}

// Tiny non-crypto hash so we get a short stable ID per image URL.
function hash32(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// ── The Met Museum ─────────────────────────────────────────────────────────
// Specialist provider — only included in the chain when the query matches
// the `art` category. Without that gating it returns false positives for
// modern queries ("interior design" → 18th-century cabinet records); WITH
// that gating, its narrow fine-art vocabulary becomes a feature.
// Free, no key.
async function metSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const searchUrl = new URL('https://collectionapi.metmuseum.org/public/collection/v1/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('hasImages', 'true');

  const searchRes = await fetch(searchUrl, { next: { revalidate: 600 } });
  if (!searchRes.ok) throw new Error(`Met ${searchRes.status}`);
  const searchData = await searchRes.json();
  const allIds: number[] = searchData.objectIDs ?? [];
  if (allIds.length === 0) return [];

  const start = (page - 1) * 20;
  const ids = allIds.slice(start, start + 20);

  const objects = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, {
        next: { revalidate: 86400 },
      });
      if (!r.ok) return null;
      return r.json();
    })
  );

  return objects
    .filter((o): o is any => !!o && !!o.primaryImageSmall)
    .map((o): MoodBoardPhoto => ({
      id: `met:${o.objectID}`,
      provider: 'met',
      width: 0,
      height: 0,
      alt: o.title ?? '',
      thumb: o.primaryImageSmall,
      regular: o.primaryImage || o.primaryImageSmall,
      full: o.primaryImage || o.primaryImageSmall,
      attribution: {
        name: o.artistDisplayName?.trim() || o.culture || 'The Met',
        profileUrl: o.objectURL || 'https://www.metmuseum.org',
      },
    }));
}

// ── Category routing ───────────────────────────────────────────────────────

// Keyword → category lookup. A query that contains any keyword for a
// category counts as a match for that category. Keep keywords lowercase;
// the input is normalized before lookup.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  fashion: [
    'fashion', 'outfit', 'style', 'streetwear', 'menswear', 'womenswear',
    'clothing', 'apparel', 'runway', 'editorial', 'lookbook', 'ootd',
    'wardrobe', 'denim', 'sneaker', 'shoes', 'jacket', 'suit',
  ],
  art: [
    'art ', 'painting', 'sculpture', 'masterpiece', 'museum', 'gallery',
    'classical', 'baroque', 'renaissance', 'impressionism', 'expressionism',
    'abstract', 'still life', 'fine art', 'portrait painting',
  ],
  architecture: [
    'architecture', 'building', 'brutalism', 'brutalist', 'bauhaus',
    'modernism', 'modernist', 'gothic', 'art deco', 'art nouveau',
    'cathedral', 'skyscraper', 'pavilion', 'facade',
  ],
  interiors: [
    'interior', 'living room', 'bedroom', 'kitchen', 'home decor', 'decor',
    'furniture', 'mid century modern', 'mid-century', 'scandinavian',
    'minimalism', 'minimalist',
  ],
  design: [
    'design', 'typography', 'poster', 'branding', 'graphic', 'layout',
    'logo', 'editorial design', 'print design',
  ],
  vintage: [
    'vintage', 'retro', 'antique', 'classic', '60s', '70s', '80s', '90s',
    'mid century', 'mid-century', 'art deco', 'victorian', 'edwardian',
  ],
  nature: [
    'nature', 'landscape', 'mountain', 'forest', 'ocean', 'beach', 'sunset',
    'sunrise', 'flowers', 'plants', 'wildlife', 'animal',
  ],
  photography: [
    'photography', 'photograph', 'portrait', 'street photography',
    'film photography', 'analog', 'polaroid',
  ],
};

function detectCategories(query: string): Set<string> {
  const q = query.toLowerCase();
  const matched = new Set<string>();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => q.includes(kw))) matched.add(category);
  }
  return matched;
}

// ── Public registry ────────────────────────────────────────────────────────

// Each provider carries the list of categories it's strong in plus an
// optional `specialist` flag. Specialist providers (e.g. The Met) only
// enter the chain when the query matches one of their categories; the
// rest are generalists and always available, just deprioritized when
// other providers score higher for the current query.
type ProviderConfig = {
  id: ProviderId;
  configured: () => boolean;
  fn: ProviderFn;
  categories: string[];
  specialist?: boolean;
};

const ALL_PROVIDERS: ProviderConfig[] = [
  {
    id: 'unsplash',
    configured: () => !!process.env.UNSPLASH_ACCESS_KEY,
    fn: unsplashSearch,
    categories: ['photography', 'nature', 'design', 'interiors'],
  },
  {
    id: 'pexels',
    configured: () => !!process.env.PEXELS_API_KEY,
    fn: pexelsSearch,
    categories: ['photography', 'nature'],
  },
  {
    id: 'openverse',
    configured: () => true,
    fn: openverseSearch,
    categories: ['photography', 'art', 'architecture', 'historical', 'design'],
  },
  {
    id: 'europeana',
    configured: () => !!process.env.EUROPEANA_API_KEY,
    fn: europeanaSearch,
    categories: ['art', 'historical', 'vintage', 'fashion', 'design'],
  },
  {
    id: 'tumblr',
    configured: () => !!process.env.TUMBLR_API_KEY,
    fn: tumblrSearch,
    categories: ['fashion', 'design', 'photography', 'interiors', 'vintage'],
  },
  {
    id: 'google',
    configured: () => !!process.env.GOOGLE_CSE_API_KEY && !!process.env.GOOGLE_CSE_ENGINE_ID,
    fn: googleSearch,
    // Google CSE indexes Pinterest, fashion blogs, editorial sites, etc.
    // Strong on the categories where Pinterest itself dominates and our
    // other providers struggle (niche fashion subcultures, room styling,
    // product photography). Stays a generalist — for art queries the
    // dedicated museum APIs still rank higher.
    categories: ['fashion', 'interiors', 'design', 'photography'],
  },
  {
    id: 'met',
    configured: () => true,
    fn: metSearch,
    categories: ['art', 'vintage', 'historical'],
    specialist: true, // only joins the chain when an `art` query is detected
  },
];

export function configuredProviders() {
  return ALL_PROVIDERS.filter((p) => p.configured());
}

export function getProviderById(id: string): { id: ProviderId; fn: ProviderFn } | null {
  const found = configuredProviders().find((p) => p.id === id);
  return found ? { id: found.id, fn: found.fn } : null;
}

// Round-robin state — only consumed when there's no category signal in
// the query (generic searches like "sunset"). Category-routed searches
// pick deterministically by score, so they don't touch this counter.
let cursor = 0;

function scoreProvider(p: ProviderConfig, categories: Set<string>): number {
  if (categories.size === 0) return 0;
  let score = 0;
  for (const cat of p.categories) {
    if (categories.has(cat)) score++;
  }
  return score;
}

/**
 * Build a provider chain for a request, applying:
 *  - excluded — drop these from consideration entirely
 *  - preferred — for sticky-provider Load More, pin this one to the front
 *  - query — detect categories; specialists join only on a match,
 *    generalists are sorted by score (highest first). Ties round-robin.
 *
 * Returns ordered { id, fn } so the route can try them in sequence.
 */
export function buildProviderChain(
  query: string | null,
  excluded: Set<string>,
  preferred?: string
): Array<{ id: ProviderId; fn: ProviderFn }> {
  const categories = detectCategories(query ?? '');
  const haveSignal = categories.size > 0;

  const remaining = configuredProviders().filter((p) => {
    if (excluded.has(p.id)) return false;
    // Specialists only join when we have a category signal AND they
    // score on at least one of the matched categories.
    if (p.specialist) {
      if (!haveSignal) return false;
      return scoreProvider(p, categories) > 0;
    }
    return true;
  });
  if (remaining.length === 0) return [];

  // Sticky-provider Load More: pin preferred to the head, sort the rest
  // by category score so the next fallback is the best remaining option.
  if (preferred) {
    const head = remaining.find((p) => p.id === preferred);
    if (head) {
      const tail = remaining.filter((p) => p.id !== preferred);
      if (haveSignal) {
        tail.sort((a, b) => scoreProvider(b, categories) - scoreProvider(a, categories));
      }
      return [head, ...tail].map(({ id, fn }) => ({ id, fn }));
    }
    // Preferred isn't in the configured/remaining set — fall through
  }

  if (haveSignal) {
    // Stable sort: score descending, then break ties by a round-robin
    // rotation through the same-score group so users see variety.
    const indexed = remaining.map((p, i) => ({ p, i }));
    indexed.sort((a, b) => {
      const sa = scoreProvider(a.p, categories);
      const sb = scoreProvider(b.p, categories);
      if (sa !== sb) return sb - sa;
      // Same score — rotate using a per-call cursor advance so tie
      // groups don't always start with the same provider.
      return a.i - b.i;
    });
    // Rotate within the top-scoring group by cursor (variety across requests).
    const topScore = scoreProvider(indexed[0].p, categories);
    const topGroup = indexed.filter(({ p }) => scoreProvider(p, categories) === topScore);
    if (topGroup.length > 1) {
      const start = cursor++ % topGroup.length;
      const rotated = [...topGroup.slice(start), ...topGroup.slice(0, start)];
      const restGroup = indexed.filter(({ p }) => scoreProvider(p, categories) !== topScore);
      return [...rotated, ...restGroup].map(({ p }) => ({ id: p.id, fn: p.fn }));
    }
    return indexed.map(({ p }) => ({ id: p.id, fn: p.fn }));
  }

  // No category signal — pure round-robin (the original behavior for
  // generic queries like "sunset" or single-word terms not in the map).
  const start = cursor++ % remaining.length;
  const ordered = [...remaining.slice(start), ...remaining.slice(0, start)];
  return ordered.map(({ id, fn }) => ({ id, fn }));
}
