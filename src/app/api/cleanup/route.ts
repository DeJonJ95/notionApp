import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sessionUserId } from '@/lib/sessionUser';
import { collectCandidates } from '@/lib/cleanup/candidates';
import { deleteDatabasesWithRows, deletePages } from '@/lib/cleanup/purge';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [pages, dbs] = await Promise.all([
    prisma.page.findMany({
      where: { workspace: { ownerId: userId }, databaseId: null },
      select: {
        id: true, title: true, updatedAt: true, isArchived: true,
        workspace: { select: { name: true } },
        journalEntry: { select: { id: true } },
        _count: { select: { blocks: true, children: true } },
      },
    }),
    prisma.database.findMany({
      where: { workspace: { ownerId: userId } },
      select: {
        id: true, name: true, createdAt: true,
        workspace: { select: { name: true } },
        _count: { select: { pages: true } },
        pages: { select: { updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    }),
  ]);

  const candidates = collectCandidates(
    pages.map((p) => ({
      id: p.id, title: p.title, workspace: p.workspace.name, updatedAt: p.updatedAt, isArchived: p.isArchived,
      isJournal: Boolean(p.journalEntry), blocks: p._count.blocks, children: p._count.children,
    })),
    dbs.map((d) => ({ id: d.id, name: d.name, workspace: d.workspace.name, rows: d._count.pages, lastEdited: d.pages[0]?.updatedAt ?? d.createdAt })),
  );
  return NextResponse.json({ candidates, scanned: { pages: pages.length, databases: dbs.length } });
}

const purgeSchema = z.object({
  pageIds: z.array(z.string()).max(2000).default([]),
  databaseIds: z.array(z.string()).max(500).default([]),
});

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = purgeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const databases = await deleteDatabasesWithRows(userId, parsed.data.databaseIds);
  const pages = await deletePages(userId, parsed.data.pageIds);
  return NextResponse.json({ databases, pages });
}
