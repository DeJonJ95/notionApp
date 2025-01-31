import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function ownView(dbId: string, viewId: string, userId: string) {
  return prisma.view.findFirst({
    where: { id: viewId, databaseId: dbId, database: { workspace: { ownerId: userId } } },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; viewId: string } }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const view = await ownView(params.id, params.viewId, userId);
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  if ('filters' in body) data.filters = body.filters ?? null;
  if ('sorts' in body) data.sorts = body.sorts ?? null;
  if ('grouping' in body) data.grouping = body.grouping ?? null;
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const updated = await prisma.view.update({ where: { id: params.viewId }, data });
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.message?.includes('does not exist') || e?.code === 'P2022' || e?.code === 'P2021') {
      return NextResponse.json(
        { error: 'View.grouping column missing — run the migration SQL.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; viewId: string } }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const view = await ownView(params.id, params.viewId, userId);
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.view.delete({ where: { id: params.viewId } });
  return NextResponse.json({ ok: true });
}
