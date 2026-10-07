import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { rankListings } from '@/lib/jobs/rank';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AI = 15;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

// Re-ranks every listing by skill overlap, then quick-scores the top `ai`
// unscored ones. Called by the dashboard and after the extension's bulk import.
export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ai = Math.max(0, Math.min(MAX_AI, Number(body?.ai ?? 10) || 0));
  const result = await rankListings(ctx.userId, ai);
  return jsonWithCors(req, result, { status: result.error ? 400 : 200 });
}
