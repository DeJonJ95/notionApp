import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  workspaceId: z.string(),
  parentId: z.string().nullable().optional(),
  title: z.string().optional(),
  icon: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  const pages = await prisma.page.findMany({
    where: {
      authorId: userId,
      isArchived: false,
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: {
      id: true,
      title: true,
      icon: true,
      parentId: true,
      workspaceId: true,
      isFavorite: true,
      position: true,
      updatedAt: true,
    },
    orderBy: { position: 'asc' },
  });
  return NextResponse.json(pages);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Verify workspace ownership
  const ws = await prisma.workspace.findFirst({
    where: { id: parsed.data.workspaceId, ownerId: userId },
  });
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Get max position among siblings
  const last = await prisma.page.findFirst({
    where: {
      workspaceId: parsed.data.workspaceId,
      parentId: parsed.data.parentId ?? null,
    },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const page = await prisma.page.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      parentId: parsed.data.parentId ?? null,
      title: parsed.data.title ?? 'Untitled',
      icon: parsed.data.icon,
      authorId: userId,
      position: (last?.position ?? 0) + 1024,
    },
  });
  return NextResponse.json(page);
}
