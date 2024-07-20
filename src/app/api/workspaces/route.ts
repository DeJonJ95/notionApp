import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const workspaces = await prisma.workspace.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
    include: {
      databases: {
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  return NextResponse.json(workspaces);
}
