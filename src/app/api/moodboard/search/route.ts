import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOwner } from '@/lib/owner';

// Trimmed shape we hand to the client — the full Unsplash payload is much larger.
// `download_location` is the URL we must hit to satisfy Unsplash's API guidelines
// when the user actually picks a photo to use (NOT on every search).
export type MoodBoardPhoto = {
  id: string;
  width: number;
  height: number;
  alt: string;
  thumb: string;       // ~200px, for the grid
  regular: string;     // ~1080px, for previews
  full: string;        // full-size, used when we copy bytes to R2
  downloadEndpoint: string;
  attribution: {
    name: string;
    profileUrl: string;
  };
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Owner-only while we're on Unsplash's 50-req/hr demo tier. Once we get
  // production approval + a per-user rate cap, this gate comes off.
  if (!isOwner(session)) {
    return NextResponse.json({ error: 'Mood board is not available on this account yet.' }, { status: 403 });
  }

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'Mood board search is not configured — set UNSPLASH_ACCESS_KEY.' },
      { status: 503 }
    );
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1') || 1);
  if (!q) return NextResponse.json({ results: [], totalPages: 0 });

  // 20 per page maps cleanly to a 5-column grid (4 rows per page).
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', q);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '20');
  url.searchParams.set('orientation', 'squarish'); // looks nicer in a uniform grid
  url.searchParams.set('content_filter', 'high');  // SFW-only

  const res = await fetch(url, {
    headers: {
      'Accept-Version': 'v1',
      Authorization: `Client-ID ${key}`,
    },
    // Cache identical queries for a few minutes — Unsplash results are stable
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: 'Unsplash error', detail: detail.slice(0, 200) },
      { status: res.status }
    );
  }

  const data = await res.json();
  const results: MoodBoardPhoto[] = (data.results ?? []).map((p: any) => ({
    id: p.id,
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

  return NextResponse.json({ results, totalPages: data.total_pages ?? 0 });
}
