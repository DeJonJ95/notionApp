import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function ensureOwned(id: string, userId: string) {
  const w = await prisma.workspace.findFirst({ where: { id, ownerId: userId } });
  return w;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await ensureOwned(params.id, userId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (body.icon === null || typeof body.icon === 'string') data.icon = body.icon;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.workspace.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await ensureOwned(params.id, userId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Refuse to delete the user's last workspace — they'd be left with no home
  const count = await prisma.workspace.count({ where: { ownerId: userId } });
  if (count <= 1) {
    return NextResponse.json(
      { error: 'You need at least one workspace. Create another before deleting this one.' },
      { status: 400 }
    );
  }

  // Cascade removes pages, databases, blocks, etc. via Prisma onDelete: Cascade
  await prisma.workspace.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
