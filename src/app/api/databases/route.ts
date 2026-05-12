import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');

  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID required' }, { status: 400 });
  }

  try {
    const databases = await prisma.database.findMany({
      where: { workspaceId },
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
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, workspaceId } = await request.json();

  if (!name || !workspaceId) {
    return NextResponse.json({ error: 'Name and workspaceId required' }, { status: 400 });
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