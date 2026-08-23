import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// File / rename / archive a single inbox item. Scoped to the page's author.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId },
    select: { id: true },
  });
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.archive === true) data.isArchived = true;
  if (body.archive === false) data.isArchived = false;
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 200);
  if (typeof body.workspaceId === 'string') {
    const ws = await prisma.workspace.findFirst({
      where: { id: body.workspaceId, ownerId: userId },
      select: { id: true },
    });
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 403 });
    data.workspaceId = ws.id;
    data.parentId = null; // land at the destination workspace root
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  await prisma.page.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}
