import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await prisma.database.findFirst({
    where: { id: params.id, workspace: { ownerId: userId } },
    select: { id: true, workspaceId: true },
  });
  if (!db) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.database.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true, workspaceId: db.workspaceId });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const database = await prisma.database.findFirst({
      where: { id: params.id },
      include: {
        workspace: { select: { id: true, name: true, slug: true, icon: true } },
        properties: {
          orderBy: { position: 'asc' },
        },
        views: true,
        pages: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            icon: true,
            position: true,
            properties: {
              select: {
                property: true,
                value: true,
              },
            },
          },
        },
      },
    });

    if (!database) {
      return NextResponse.json({ error: 'Database not found' }, { status: 404 });
    }

    return NextResponse.json(database);
  } catch (error) {
    console.error('Error fetching database:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}