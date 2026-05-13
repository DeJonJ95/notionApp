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

function journalTemplate() {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '📋 Work Log' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '💭 Reflections' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: "✅ Tomorrow's Priorities" }],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph' }] },
        ],
      },
    ],
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  // Client sends its local date (YYYY-MM-DD) to avoid UTC/local mismatch.
  // Fall back to server UTC date if omitted.
  const dateParam =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().split('T')[0];

  // Validate format loosely
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const title = buildTitle(dateParam);

  // Prefer workspace named "Personal"; fall back to the oldest workspace.
  const workspace =
    (await prisma.workspace.findFirst({
      where: { ownerId: userId, name: { equals: 'Personal', mode: 'insensitive' } },
    })) ??
    (await prisma.workspace.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    }));

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 });
  }

  // Idempotent: return existing page if already created today.
  const existing = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title, isArchived: false },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ pageId: existing.id, created: false });
  }

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
        content: journalTemplate(),
      },
    });
    return p;
  });

  return NextResponse.json({ pageId: page.id, created: true });
}
