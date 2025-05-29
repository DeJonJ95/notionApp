import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOwner } from '@/lib/owner';
import {
  nextProviderChain,
  configuredProviders,
  type MoodBoardPhoto,
} from '@/lib/moodboardProviders';

// Re-export so the modal's existing `import type` keeps working unchanged.
export type { MoodBoardPhoto } from '@/lib/moodboardProviders';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session)) {
    return NextResponse.json({ error: 'Mood board is not available on this account yet.' }, { status: 403 });
  }

  if (configuredProviders().length === 0) {
    return NextResponse.json(
      { error: 'Mood board has no providers configured — set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.' },
      { status: 503 }
    );
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1') || 1);
  if (!q) return NextResponse.json({ results: [], totalPages: 0, provider: null });

  // Round-robin pick + fallback chain. If the rotated-to provider 429s or
  // errors, try the next one. We stop on the first non-empty result so
  // pagination stays sane within a single provider per query.
  const chain = nextProviderChain();
  const errors: { provider: string; message: string }[] = [];

  for (const { id, fn } of chain) {
    try {
      const results = await fn(q, page);
      if (results.length > 0) {
        return NextResponse.json({
          results,
          provider: id,
          // We don't have a real total-pages count across providers, so
          // give the UI a generous number when there were results so it
          // shows "Load more". The next page will round-robin again.
          totalPages: results.length === 20 ? page + 1 : page,
        });
      }
      // Empty result = try next provider (e.g. Met has no images for the query)
    } catch (e: any) {
      errors.push({ provider: id, message: e?.message ?? String(e) });
    }
  }

  // Nothing came back from anyone — return whatever errors we collected
  // so the client knows it wasn't a clean "no results" miss.
  if (errors.length === chain.length) {
    return NextResponse.json(
      { error: 'All providers failed', details: errors },
      { status: 502 }
    );
  }
  return NextResponse.json({ results: [] as MoodBoardPhoto[], totalPages: 0, provider: null });
}
