import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { propertyId, pageId, value } = await request.json();

  if (!propertyId || !pageId) {
    return NextResponse.json({ error: 'PropertyId and pageId required' }, { status: 400 });
  }

  try {
    const propertyValue = await prisma.propertyValue.upsert({
      where: {
        propertyId_pageId: {
          propertyId,
          pageId,
        },
      },
      update: {
        value,
      },
      create: {
        propertyId,
        pageId,
        value,
      },
    });

    return NextResponse.json(propertyValue);
  } catch (error) {
    console.error('Error updating property value:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}