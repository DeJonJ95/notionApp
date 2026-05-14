import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  position: z.number().optional(),
  content: z.any().optional(), // legacy: TipTap JSON document (kept for backwards compat)
});

async function ensureOwner(pageId: string, userId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: userId },
  });
  return page;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const page = await ensureOwner(params.id, userId);
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const blocks = await prisma.block.findMany({
    where: { pageId: params.id },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json({ ...page, blocks });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const page = await ensureOwner(params.id, userId);
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { content, ...pageFields } = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.page.update({
      where: { id: params.id },
      data: pageFields,
    });

    if (content !== undefined) {
      const existing = await tx.block.findFirst({
        where: { pageId: params.id, type: 'document' },
      });
      if (existing) {
        await tx.block.update({
          where: { id: existing.id },
          data: { content },
        });
      } else {
        await tx.block.create({
          data: { pageId: params.id, type: 'document', content, position: 0 },
        });
      }
    }
    return p;
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const page = await ensureOwner(params.id, userId);
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.page.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
