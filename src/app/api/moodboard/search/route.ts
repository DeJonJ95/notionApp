import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOwner } from '@/lib/owner';
import {
  buildProviderChain,
  configuredProviders,
  type MoodBoardPhoto,
} from '@/lib/moodboardProviders';

// Re-export so the modal's existing `import type` keeps working unchanged.
export type { MoodBoardPhoto } from '@/lib/moodboardProviders';

const MIN_GOOD_RESULTS = 8;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session)) {
    return NextResponse.json({ error: 'Mood board is not available on this account yet.' }, { status: 403 });
  }

  const all = configuredProviders();
  if (all.length === 0) {
    return NextResponse.json(
      { error: 'Mood board has no providers configured.' },
      { status: 503 }
    );
  }
  const availableProviders = all.map((p) => p.id);

  const q = req.nextUrl.searchParams.get('q')?.trim();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1') || 1);
  const preferred = req.nextUrl.searchParams.get('provider') ?? undefined;
  const excluded = new Set(
    (req.nextUrl.searchParams.get('exclude') ?? '').split(',').filter(Boolean)
  );

  if (!q) {
    return NextResponse.json({
      results: [],
      provider: null,
      exhausted: false,
      availableProviders,
    });
  }

  const chain = buildProviderChain(q, excluded, preferred);
  if (chain.length === 0) {
    // Every provider is excluded — nothing left to try
    return NextResponse.json({
      results: [],
      provider: null,
      exhausted: true,
      availableProviders,
    });
  }

  const errors: { provider: string; message: string }[] = [];
  let bestPartial: { id: string; results: MoodBoardPhoto[] } | null = null;

  for (const { id, fn } of chain) {
    try {
      const results = await fn(q, page);
      if (results.length >= MIN_GOOD_RESULTS) {
        return NextResponse.json({
          results,
          provider: id,
          // "exhausted" tells the client whether this provider has more
          // to give on a subsequent page. A short page means we're at
          // the end of what it knows about this query.
          exhausted: results.length < 20,
          availableProviders,
        });
      }
      if (results.length > 0 && (!bestPartial || results.length > bestPartial.results.length)) {
        bestPartial = { id, results };
      }
    } catch (e: any) {
      errors.push({ provider: id, message: e?.message ?? String(e) });
    }
  }

  // No provider hit the bar. Serve the largest partial if we have one —
  // mark it exhausted so the next Load More moves on.
  if (bestPartial) {
    return NextResponse.json({
      results: bestPartial.results,
      provider: bestPartial.id,
      exhausted: true,
      availableProviders,
    });
  }

  if (errors.length === chain.length) {
    return NextResponse.json(
      { error: 'All providers failed', details: errors, availableProviders },
      { status: 502 }
    );
  }
  return NextResponse.json({
    results: [] as MoodBoardPhoto[],
    provider: null,
    exhausted: true,
    availableProviders,
  });
}
