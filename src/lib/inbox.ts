import { prisma } from './prisma';
import { textToDoc } from './htmlToTipTap';

// The Inbox is a per-user workspace (slug 'inbox') that captured items land
// in before being triaged out to a real workspace. It's created lazily the
// first time anything is captured, so existing users don't need a migration.

export async function findOrCreateInboxWorkspace(userId: string): Promise<{ id: string }> {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, slug: 'inbox' },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.workspace.create({
    data: { name: 'Inbox', slug: 'inbox', icon: 'mail', color: '#8B5CF6', ownerId: userId },
    select: { id: true },
  });
}

function firstLine(s: string, max = 100): string {
  const line = s.split('\n').map((x) => x.trim()).find(Boolean) ?? '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

/** Create a captured page in the user's Inbox. Returns the new page id. */
export async function createInboxItem(
  userId: string,
  input: { text?: string; title?: string; url?: string }
): Promise<string> {
  const text = (input.text ?? '').trim();
  const url = (input.url ?? '').trim();
  const title = ((input.title ?? '').trim() || firstLine(text) || url || 'Captured note').slice(0, 200);

  const ws = await findOrCreateInboxWorkspace(userId);
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
      icon: '📥',
      authorId: userId,
      position: (first?.position ?? 1024) - 1024,
    },
    select: { id: true },
  });

  const bodyText = [text, url].filter(Boolean).join('\n\n');
  if (bodyText) {
    await prisma.block.create({
      data: { pageId: page.id, type: 'text', content: textToDoc(bodyText) as any, position: 0 },
    });
  }
  return page.id;
}

/** Flatten a TipTap doc (Block.content JSON) to a plain-text snippet. */
export function docText(content: any): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node.text === 'string') parts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
