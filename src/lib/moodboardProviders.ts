// Image providers for the mood board feature. Each one is a self-contained
// search function that returns a uniform shape, so the route + UI don't
// have to know which service answered. Add a new provider here, the
// rest of the app picks it up automatically via the round-robin in
// the search route.

export type ProviderId = 'unsplash' | 'pexels' | 'met';

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

// ── The Met Museum ─────────────────────────────────────────────────────────
// Free, no key. Returns ~470k cultural objects with images — fine art,
// design, photography, fashion, decorative arts. Aesthetic-adjacent to
// what gets saved on Are.na. Two-step API: search returns objectIDs,
// then we fetch the first N objects concurrently to assemble image URLs.
async function metSearch(query: string, page: number): Promise<MoodBoardPhoto[]> {
  const searchUrl = new URL('https://collectionapi.metmuseum.org/public/collection/v1/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('hasImages', 'true');

  const searchRes = await fetch(searchUrl, { next: { revalidate: 600 } });
  if (!searchRes.ok) throw new Error(`Met ${searchRes.status}`);
  const searchData = await searchRes.json();
  const allIds: number[] = searchData.objectIDs ?? [];
  if (allIds.length === 0) return [];

  // Page through the ID list 20 at a time so pagination matches the other
  // providers. The Met has no built-in pagination on search.
  const start = (page - 1) * 20;
  const ids = allIds.slice(start, start + 20);

  const objects = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, {
        next: { revalidate: 86400 }, // objects are immutable; cache hard
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
      width: 0, // Met doesn't return dimensions; UI uses aspect-square anyway
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

// ── Public registry ────────────────────────────────────────────────────────

// Provider order is the rotation order — round-robin picks the next one
// in this array per request. Met goes last because it's the slowest (two
// API hops) so the fast providers serve the bulk of traffic when configured.
const ALL_PROVIDERS: Array<{ id: ProviderId; configured: () => boolean; fn: ProviderFn }> = [
  { id: 'unsplash', configured: () => !!process.env.UNSPLASH_ACCESS_KEY, fn: unsplashSearch },
  { id: 'pexels',   configured: () => !!process.env.PEXELS_API_KEY,      fn: pexelsSearch },
  { id: 'met',      configured: () => true,                              fn: metSearch },
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
