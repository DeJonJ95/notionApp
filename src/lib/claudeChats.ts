import { prisma } from './prisma';
import { docText } from './inbox';
import type { TipTapDoc, TipTapNode } from './htmlToTipTap';

// Claude conversations captured from claude.ai by the browser extension land
// in a per-user workspace (slug 'claude-chats'), one Page per conversation,
// one Block per turn. Same lazily-created-workspace idiom as the Inbox, so
// existing users need no migration.
//
// Storing them as ordinary Pages is the whole point: the extract modal's
// "Claude chat" source just passes their pageIds to /api/extract, which
// already knows how to flatten a page into text. No new extraction path.

export const CLAUDE_CHATS_SLUG = 'claude-chats';

export type ConversationTurn = { role: 'user' | 'assistant'; text: string };

const MAX_TURNS = 200; // /api/extract reads at most 200 blocks per page
const MAX_TURN_CHARS = 20_000;
const MAX_TOTAL_CHARS = 240_000;
const ROLE_LABEL: Record<ConversationTurn['role'], string> = {
  user: 'You',
  assistant: 'Claude',
};

export async function findOrCreateClaudeChatsWorkspace(userId: string): Promise<{ id: string }> {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, slug: CLAUDE_CHATS_SLUG },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.workspace.create({
    data: {
      name: 'Claude Chats',
      slug: CLAUDE_CHATS_SLUG,
      icon: 'chat',
      color: '#D97757',
      ownerId: userId,
    },
    select: { id: true },
  });
}

/**
 * The conversation's stable id, pulled out of a claude.ai URL
 * (`https://claude.ai/chat/<uuid>`). Used to recognise a re-capture of the
 * same thread so it updates in place instead of piling up duplicate pages.
 * Returns '' when the URL carries no id, which disables dedup for that call.
 */
export function conversationIdFromUrl(sourceUrl: string): string {
  const m = /\/chat\/([0-9a-zA-Z_-]{8,})/.exec(sourceUrl ?? '');
  return m ? m[1] : '';
}

/** Coerce whatever the extension posted into clean, bounded turns. */
export function normalizeTurns(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationTurn[] = [];
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as any).role === 'user' ? 'user' : 'assistant';
    const text = typeof (item as any).text === 'string' ? (item as any).text.trim() : '';
    if (!text) continue;
    const clipped = text.slice(0, MAX_TURN_CHARS);
    if (total + clipped.length > MAX_TOTAL_CHARS) break;
    total += clipped.length;
    out.push({ role, text: clipped });
    if (out.length >= MAX_TURNS) break;
  }
  return out;
}

/**
 * One turn → one TipTap doc: an H3 speaker label followed by a paragraph per
 * line. Unlike `textToDoc` this keeps single newlines as separate paragraphs,
 * because in a transcript they carry list items and code lines.
 */
function turnDoc(turn: ConversationTurn): TipTapDoc {
  const content: TipTapNode[] = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: ROLE_LABEL[turn.role] }] },
  ];
  for (const line of turn.text.split('\n')) {
    const t = line.trim();
    if (t) content.push({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  }
  if (content.length === 1) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function sourceDoc(sourceUrl: string, turnCount: number): TipTapDoc {
  const stamp = new Date().toISOString().slice(0, 10);
  const bits = [`Claude conversation · ${turnCount} turn${turnCount === 1 ? '' : 's'} · captured ${stamp}`];
  if (sourceUrl) bits.push(sourceUrl);
  return {
    type: 'doc',
    content: bits.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

/**
 * Find an already-captured page for this conversation. The conversation id
 * lives in the source line (block position 0), so we read the first block of
 * each page in the workspace and match on it. The workspace only ever holds
 * this user's captured chats, so the scan stays small.
 */
async function findExistingCapture(workspaceId: string, convId: string): Promise<string | null> {
  if (!convId) return null;
  const pages = await prisma.page.findMany({
    where: { workspaceId, isArchived: false },
    select: { id: true, blocks: { orderBy: { position: 'asc' }, take: 1, select: { content: true } } },
    take: 500,
  });
  const hit = pages.find((p) => docText(p.blocks[0]?.content).includes(convId));
  return hit?.id ?? null;
}

export type SaveResult = { pageId: string; created: boolean; turnCount: number };

/**
 * Upsert a captured conversation. Re-capturing the same thread (after chatting
 * further) replaces its blocks rather than creating a second page, so the page
 * always holds the whole transcript as of the last capture.
 */
export async function saveClaudeConversation(
  userId: string,
  input: { sourceUrl?: string; title?: string; turns: ConversationTurn[] }
): Promise<SaveResult> {
  const turns = input.turns;
  const sourceUrl = (input.sourceUrl ?? '').trim().slice(0, 2_000);
  const firstUserTurn = turns.find((t) => t.role === 'user')?.text ?? '';
  const title = (
    (input.title ?? '').trim() ||
    firstUserTurn.split('\n').map((s) => s.trim()).find(Boolean) ||
    'Claude conversation'
  ).slice(0, 200);

  const ws = await findOrCreateClaudeChatsWorkspace(userId);
  const convId = conversationIdFromUrl(sourceUrl);
  const existingId = await findExistingCapture(ws.id, convId);

  let pageId: string;
  if (existingId) {
    pageId = existingId;
    await prisma.page.update({ where: { id: pageId }, data: { title } });
    await prisma.block.deleteMany({ where: { pageId } });
  } else {
    const first = await prisma.page.findFirst({
      where: { workspaceId: ws.id, parentId: null },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const page = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        parentId: null,
        title,
        icon: '💬',
        authorId: userId,
        position: (first?.position ?? 1024) - 1024,
      },
      select: { id: true },
    });
    pageId = page.id;
  }

  await prisma.block.createMany({
    data: [
      { pageId, type: 'text', content: sourceDoc(sourceUrl, turns.length) as any, position: 0 },
      ...turns.map((turn, i) => ({
        pageId,
        type: 'text',
        content: turnDoc(turn) as any,
        position: i + 1,
      })),
    ],
  });

  return { pageId, created: !existingId, turnCount: turns.length };
}
