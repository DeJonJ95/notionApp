import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  content: z.any().optional(),
  canvasX: z.number().optional(),
  canvasY: z.number().optional(),
  canvasWidth: z.number().optional(),
  position: z.number().optional(),
});

async function ensureOwner(blockId: string, userId: string) {
  return prisma.block.findFirst({
    where: { id: blockId, page: { authorId: userId } },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const block = await ensureOwner(params.id, userId);
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await prisma.block.update({
    where: { id: params.id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const block = await ensureOwner(params.id, userId);
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.block.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
