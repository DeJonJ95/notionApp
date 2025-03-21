import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Build the display title from a YYYY-MM-DD string using the *local* calendar
// (the client always passes its own date so server timezone is irrelevant).
function buildTitle(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `Journal — ${date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}`;
}

// Recursively flatten the text of a TipTap node.
function nodeText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (Array.isArray(node.content)) return node.content.map(nodeText).join('');
  return '';
}

// Pull the bullet/checklist items that sit under the "Tomorrow's Priorities"
// heading in yesterday's journal. Works whether the page is still a single
// legacy `document` block or was opened and split into canvas text blocks
// (we flatten top-level nodes across all blocks, in order).
function extractCarryOver(blocks: { content: unknown }[]): string[] {
  const nodes: any[] = [];
  for (const b of blocks) {
    const c = b.content as any;
    if (c && Array.isArray(c.content)) nodes.push(...c.content);
  }
  const start = nodes.findIndex(
    (n) => n?.type === 'heading' && /tomorrow'?s\s+priorit/i.test(nodeText(n))
  );
  if (start === -1) return [];
  const items: string[] = [];
  for (let j = start + 1; j < nodes.length; j++) {
    const n = nodes[j];
    if (n?.type === 'heading') break; // next section
    if (n?.type === 'bulletList' || n?.type === 'orderedList' || n?.type === 'taskList') {
      for (const li of n.content ?? []) {
        const t = nodeText(li).replace(/\s+/g, ' ').trim();
        if (t) items.push(t);
      }
    }
  }
  return items;
}

function journalTemplate(carryTodos: string[]) {
  const taskItems = (carryTodos.length ? carryTodos : ['']).map((text) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [
      { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
    ],
  }));

  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: "✅ Today's To-Do List" }],
      },
      { type: 'taskList', content: taskItems },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '💭 Journal' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: "🌅 Tomorrow's Priorities" }],
      },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
      },
    ],
  };
}

async function getOrCreateJournalWorkspace(userId: string) {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, name: { equals: 'Daily Journals', mode: 'insensitive' } },
  });
  if (existing) return existing;

  // Unique per-owner slug (schema has @@unique([ownerId, slug]))
  let slug = 'daily-journals';
  let n = 1;
  while (await prisma.workspace.findFirst({ where: { ownerId: userId, slug } })) {
    n++;
    slug = `daily-journals-${n}`;
    if (n > 50) break;
  }
  return prisma.workspace.create({
    data: { name: 'Daily Journals', slug, icon: '📔', ownerId: userId },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const dateParam =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().split('T')[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const title = buildTitle(dateParam);
  const workspace = await getOrCreateJournalWorkspace(userId);

  // Idempotent: return existing page if today's journal already exists.
  const existing = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title, isArchived: false },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ pageId: existing.id, created: false });
  }

  // Carry yesterday's "Tomorrow's Priorities" into today's "To-Do List".
  const [y, m, d] = dateParam.split('-').map(Number);
  const yd = new Date(y, m - 1, d - 1);
  const ydIso = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
  const prev = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title: buildTitle(ydIso), isArchived: false },
    include: { blocks: { orderBy: { position: 'asc' } } },
  });
  const carryTodos = prev ? extractCarryOver(prev.blocks) : [];

  // Place after the last top-level page in the workspace.
  const last = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, parentId: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const page = await prisma.$transaction(async (tx) => {
    const p = await tx.page.create({
      data: {
        workspaceId: workspace.id,
        title,
        icon: '📔',
        authorId: userId,
        position: (last?.position ?? 0) + 1024,
      },
    });
    await tx.block.create({
      data: {
        pageId: p.id,
        type: 'document',
        position: 0,
        content: journalTemplate(carryTodos),
      },
    });
    return p;
  });

  return NextResponse.json({ pageId: page.id, created: true, carried: carryTodos.length });
}
