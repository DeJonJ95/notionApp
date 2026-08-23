import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findOrCreateInboxWorkspace, docText } from '@/lib/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ws = await findOrCreateInboxWorkspace(userId);

  const [pages, workspaces] = await Promise.all([
    prisma.page.findMany({
      where: { workspaceId: ws.id, isArchived: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { blocks: { orderBy: { position: 'asc' }, take: 1 } },
    }),
    prisma.workspace.findMany({
      where: { ownerId: userId, slug: { not: 'inbox' } },
      select: { id: true, name: true, slug: true, icon: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const items = pages.map((p) => {
    const snippet = docText(p.blocks[0]?.content).slice(0, 200);
    return { id: p.id, title: p.title, icon: p.icon, createdAt: p.createdAt, snippet };
  });

  return NextResponse.json({ inboxWorkspaceId: ws.id, items, workspaces });
}
