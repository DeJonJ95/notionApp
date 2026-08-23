import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { createInboxItem } from '@/lib/inbox';

export const runtime = 'nodejs';

// Personal capture endpoint. Authenticates with a clipper bearer token OR a
// session cookie, so it's callable from the browser app, the extension, and
// external automations (iOS Shortcuts, Tasker, cron). Body: { text?, url?, title? }.
export function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonWithCors(req, { error: 'Invalid JSON body' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  const url = typeof body.url === 'string' ? body.url : '';
  const title = typeof body.title === 'string' ? body.title : '';
  if (!text.trim() && !url.trim() && !title.trim()) {
    return jsonWithCors(req, { error: 'Provide at least one of: text, url, title' }, { status: 400 });
  }

  const pageId = await createInboxItem(ctx.userId, {
    text: text.slice(0, 20_000),
    url: url.slice(0, 2_000),
    title: title.slice(0, 200),
  });
  return jsonWithCors(req, { ok: true, pageId, path: `/page/${pageId}` }, { status: 201 });
}
