import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { normalizeTurns, saveClaudeConversation } from '@/lib/claudeChats';

export const runtime = 'nodejs';

// Receives a Claude conversation scraped from claude.ai by the extension's
// content script and stores it as a page in the user's "Claude Chats"
// workspace. Bearer-token auth (the extension) or session cookie, same as the
// other clipper endpoints.
//
// Body: { sourceUrl?, title?, turns: [{ role: 'user'|'assistant', text }] }
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

  const turns = normalizeTurns(body.turns);
  if (turns.length === 0) {
    return jsonWithCors(
      req,
      { error: 'No conversation text found. Scroll the thread into view and try again.' },
      { status: 400 }
    );
  }

  const result = await saveClaudeConversation(ctx.userId, {
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
    title: typeof body.title === 'string' ? body.title : '',
    turns,
  });

  return jsonWithCors(
    req,
    { ok: true, ...result, path: `/page/${result.pageId}` },
    { status: result.created ? 201 : 200 }
  );
}
