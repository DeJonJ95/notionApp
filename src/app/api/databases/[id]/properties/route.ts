import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, type, databaseId, formula } = await request.json();

  if (!name || !type || !databaseId) {
    return NextResponse.json({ error: 'Name, type, and databaseId required' }, { status: 400 });
  }

  try {
    const property = await prisma.property.create({
      data: {
        name,
        type,
        databaseId,
        formula,
      },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error('Error creating property:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}