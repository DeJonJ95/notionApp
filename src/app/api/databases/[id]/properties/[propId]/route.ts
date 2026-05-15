import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; propId: string } }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const property = await prisma.property.findFirst({
    where: {
      id: params.propId,
      databaseId: params.id,
      database: { workspace: { ownerId: userId } },
    },
  });
  if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const data: Record<string, any> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body.type === 'string' && body.type.trim()) data.type = body.type.trim();
  // `formula` is overloaded: real formula text for type='formula', or
  // JSON-encoded option array for type='select'. Frontend is responsible
  // for sending the right shape.
  if (body.formula === null || typeof body.formula === 'string') data.formula = body.formula;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.property.update({
    where: { id: params.propId },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; propId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const property = await prisma.property.findFirst({
      where: {
        id: params.propId,
        databaseId: params.id,
        database: {
          workspace: { ownerId: (session!.user as any).id },
        },
      },
    });

    if (!property) {
      return NextResponse.json({ error: 'Property not found or unauthorized' }, { status: 404 });
    }

    await prisma.property.delete({ where: { id: params.propId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting property:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
