// Image providers for the mood board feature. Each one is a self-contained
// search function that returns a uniform shape, so the route + UI don't
// have to know which service answered. Add a new provider here, the
// rest of the app picks it up automatically via the round-robin in
// the search route.

export type ProviderId = 'unsplash' | 'pexels' | 'openverse' | 'europeana' | 'met';

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
  url.searchParams.set('page_size', '20');
  url.searchParams.set('mature', 'false');

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`OpenVerse ${res.status}`);
  const data = await res.json();

  return (data.results ?? [])
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
        // foreign_landing_url points back to the original host (Flickr,
        // Wikimedia, museum site) which is the correct credit destination.
        profileUrl: p.foreign_landing_url || p.creator_url || 'https://openverse.org',
      },
    }));
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
  url.searchParams.set('rows', '20');
  url.searchParams.set('start', String((page - 1) * 20 + 1));
  url.searchParams.set('media', 'true');
  url.searchParams.set('qf', 'TYPE:IMAGE');
  url.searchParams.set('reusability', 'open'); // CC0/CC-BY only — safe for embed

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Europeana ${res.status}`);
  const data = await res.json();

  const firstString = (v: any): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');

  return (data.items ?? [])
    .filter((it: any) => it.edmPreview?.[0])
    .map((it: any): MoodBoardPhoto => ({
      id: `europeana:${String(it.id).replace(/\//g, '-')}`,
      provider: 'europeana',
      width: 0,
      height: 0,
      alt: firstString(it.title),
      thumb: it.edmPreview[0],
      // edmIsShownBy is the direct image URL at the source institution;
      // fall back to the preview if missing (some records only ship thumbs).
      regular: firstString(it.edmIsShownBy) || it.edmPreview[0],
      full: firstString(it.edmIsShownBy) || it.edmPreview[0],
      attribution: {
        name: firstString(it.dcCreator) || firstString(it.dataProvider) || 'Europeana',
        profileUrl: it.guid || 'https://www.europeana.eu',
      },
    }));
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
];

export function configuredProviders() {
  return ALL_PROVIDERS.filter((p) => p.configured());
}

// Round-robin state — module-level counter. Survives within a single
// serverless invocation worker; cold starts reset it. That's fine because
// the rotation is for variety, not exact fairness.
let cursor = 0;

/** Pick the next provider in rotation, plus the rest in fallback order. */
export function nextProviderChain(): Array<{ id: ProviderId; fn: ProviderFn }> {
  const list = configuredProviders();
  if (list.length === 0) return [];
  const start = cursor++ % list.length;
  // Build a rotated copy: [start, start+1, ..., wrap around to start-1]
  const ordered = [...list.slice(start), ...list.slice(0, start)];
  return ordered.map(({ id, fn }) => ({ id, fn }));
}
