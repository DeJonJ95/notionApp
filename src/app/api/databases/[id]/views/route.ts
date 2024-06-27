import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, type } = await request.json();

  if (!name || !type) {
    return NextResponse.json({ error: 'Name and type required' }, { status: 400 });
  }

  if (!['table', 'gallery', 'list', 'board', 'calendar'].includes(type)) {
    return NextResponse.json({ error: 'Unsupported view type' }, { status: 400 });
  }

  const database = await prisma.database.findFirst({
    where: {
      id: params.id,
      workspace: {
        ownerId: (session!.user as any).id,
      },
    },
  });

  if (!database) {
    return NextResponse.json({ error: 'Database not found or unauthorized' }, { status: 404 });
  }

  try {
    const view = await prisma.view.create({
      data: {
        name,
        type,
        databaseId: params.id,
      },
    });
    return NextResponse.json(view);
  } catch (error) {
    console.error('Error creating view:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
