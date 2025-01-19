import { NextRequest, NextResponse } from 'next/server';
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

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'New workspace';
  const icon = typeof body.icon === 'string' ? body.icon : null;

  // Generate a slug that's unique per-owner. The schema has a (ownerId, slug)
  // unique constraint so we have to dedupe by appending -2, -3, etc.
  const baseSlug = toSlug(name);
  let slug = baseSlug;
  let n = 1;
  // bounded loop in case the user has weird names
  while (await prisma.workspace.findFirst({ where: { ownerId: userId, slug } })) {
    n++;
    slug = `${baseSlug}-${n}`;
    if (n > 50) break;
  }

  const workspace = await prisma.workspace.create({
    data: { name, slug, icon, ownerId: userId },
  });
  return NextResponse.json(workspace);
}
