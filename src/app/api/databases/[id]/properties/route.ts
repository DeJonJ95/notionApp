import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { ownedDatabase, relationTargetOk } from '@/lib/ownership';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, type, databaseId = params.id, formula } = await request.json().catch(() => ({}));

  if (!name || !type || !databaseId) {
    return NextResponse.json({ error: 'Name, type, and databaseId required' }, { status: 400 });
  }
  if (!(await ownedDatabase(userId, databaseId)) || !(await relationTargetOk(userId, type, formula))) {
    return NextResponse.json({ error: 'Database not found' }, { status: 404 });
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

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { orderedIds, movedId, position } = await request.json().catch(() => ({}));
  if (!Array.isArray(orderedIds) || !movedId || typeof position !== 'number') {
    return NextResponse.json({ error: 'Invalid reorder payload' }, { status: 400 });
  }

  const owned = await prisma.property.findFirst({
    where: { id: movedId, databaseId: params.id, database: { workspace: { ownerId: userId } } },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

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
