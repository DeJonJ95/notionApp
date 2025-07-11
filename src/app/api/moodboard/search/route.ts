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

  // Round-robin pick + fallback chain. If the rotated-to provider 429s,
  // errors, or returns too few relevant results, try the next one. We keep
  // the best partial result around in case the whole chain underperforms,
  // so the user never gets an empty grid when there's *something* available.
  const chain = nextProviderChain();
  const errors: { provider: string; message: string }[] = [];
  let bestPartial: { id: string; results: MoodBoardPhoto[] } | null = null;
  const MIN_GOOD_RESULTS = 8; // anything less than this triggers fallthrough

  for (const { id, fn } of chain) {
    try {
      const results = await fn(q, page);
      if (results.length >= MIN_GOOD_RESULTS) {
        return NextResponse.json({
          results,
          provider: id,
          // We don't have a real total-pages count across providers, so
          // give the UI a generous number when there were results so it
          // shows "Load more". The next page will round-robin again.
          totalPages: results.length === 20 ? page + 1 : page,
        });
      }
      // Too few results — remember the biggest partial in case nothing
      // better turns up, then continue the chain.
      if (results.length > 0 && (!bestPartial || results.length > bestPartial.results.length)) {
        bestPartial = { id, results };
      }
    } catch (e: any) {
      errors.push({ provider: id, message: e?.message ?? String(e) });
    }
  }

  // No provider hit the quality bar. If we caught a partial along the way,
  // serve it — better than an empty grid.
  if (bestPartial) {
    return NextResponse.json({
      results: bestPartial.results,
      provider: bestPartial.id,
      totalPages: page,
    });
  }

  if (errors.length === chain.length) {
    return NextResponse.json(
      { error: 'All providers failed', details: errors },
      { status: 502 }
    );
  }
  return NextResponse.json({ results: [] as MoodBoardPhoto[], totalPages: 0, provider: null });
}
