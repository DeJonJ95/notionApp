import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, type, databaseId, formula } = await request.json();

  if (!name || !type || !databaseId) {
    return NextResponse.json({ error: 'Name, type, and databaseId required' }, { status: 400 });
  }

  try {
    const lastProperty = await prisma.property.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const property = await prisma.property.create({
      data: {
        name,
        type,
        formula,
        position: (lastProperty?.position ?? 0) + 1024,
        databaseId,
      },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error('Error creating property:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { orderedIds, movedId, position } = await request.json();
  if (!Array.isArray(orderedIds) || !movedId || typeof position !== 'number') {
    return NextResponse.json({ error: 'Invalid reorder payload' }, { status: 400 });
  }

  try {
    const property = await prisma.property.update({
      where: { id: movedId },
      data: { position },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error('Error reordering property:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}