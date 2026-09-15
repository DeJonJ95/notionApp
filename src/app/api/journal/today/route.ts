import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { extractCarryOver, journalTemplate } from '@/lib/journalCarryOver';

// The client always passes its own local date, so the server timezone never
// leaks into the title.
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

function previousIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const yd = new Date(y, m - 1, d - 1);
  return `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
}

async function getOrCreateJournalWorkspace(userId: string) {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, name: { equals: 'Daily Journals', mode: 'insensitive' } },
  });
  if (existing) return existing;

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
  const userId = (session.user as { id: string }).id;

  const dateParam =
    req.nextUrl.searchParams.get('date') ??
    new Date().toISOString().split('T')[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const title = buildTitle(dateParam);
  const workspace = await getOrCreateJournalWorkspace(userId);
  const dateObj = new Date(dateParam + 'T00:00:00.000Z');

  // Idempotent: reuse today's page and backfill its JournalEntry index row.
  const existing = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title, isArchived: false },
    select: { id: true },
  });
  if (existing) {
    await prisma.journalEntry.upsert({
      where: { userId_date: { userId, date: dateObj } },
      update: { pageId: existing.id },
      create: { userId, pageId: existing.id, date: dateObj },
    });
    return NextResponse.json({ pageId: existing.id, created: false });
  }

  const prev = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title: buildTitle(previousIso(dateParam)), isArchived: false },
    include: { blocks: { orderBy: { position: 'asc' } } },
  });
  const carryTodos = prev ? extractCarryOver(prev.blocks) : [];

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
      data: { pageId: p.id, type: 'document', position: 0, content: journalTemplate(carryTodos) },
    });
    await tx.journalEntry.create({ data: { userId, pageId: p.id, date: dateObj } });
    return p;
  });

  return NextResponse.json({ pageId: page.id, created: true, carried: carryTodos.length });
}
