// Extension capture endpoint. Bearer-token (or session) authenticated and
// CORS-enabled so the hiring.cafe content script can POST a scraped listing
// directly. Mirrors the clipper endpoints' auth pattern.

import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { ingestSchema, upsertListing } from '@/lib/jobs/ingest';
import { logCall } from '@/lib/logUsage';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors(req, { error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const listing = await upsertListing(ctx.userId, parsed.data);
  logCall('applykit', 'job-capture', { userId: ctx.userId });
  return jsonWithCors(req, { ok: true, listingId: listing.id });
}
