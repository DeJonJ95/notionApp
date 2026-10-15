import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { ownsWorkspace } from '@/lib/ownership';

export async function GET(request: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');

  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID required' }, { status: 400 });
  }

  try {
    const databases = await prisma.database.findMany({
      where: { workspaceId, workspace: { ownerId: userId } },
      include: {
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

    return NextResponse.json(databases);
  } catch (error) {
    console.error('Error fetching databases:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, workspaceId } = await request.json().catch(() => ({}));

  if (!name || !workspaceId) {
    return NextResponse.json({ error: 'Name and workspaceId required' }, { status: 400 });
  }
  if (!(await ownsWorkspace(userId, workspaceId))) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  try {
    const database = await prisma.database.create({
      data: {
        name,
        workspaceId,
      },
    });

    return NextResponse.json(database);
  } catch (error) {
    console.error('Error creating database:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}