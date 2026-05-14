import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  pageId: z.string(),
  type: z.string(),
  content: z.any(),
  canvasX: z.number().optional(),
  canvasY: z.number().optional(),
  canvasWidth: z.number().optional(),
  position: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Verify the user owns the page
  const page = await prisma.page.findFirst({
    where: { id: parsed.data.pageId, authorId: userId },
  });
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const block = await prisma.block.create({
    data: {
      pageId: parsed.data.pageId,
      type: parsed.data.type,
      content: parsed.data.content ?? {},
      position: parsed.data.position ?? 0,
      canvasX: parsed.data.canvasX ?? null,
      canvasY: parsed.data.canvasY ?? null,
      canvasWidth: parsed.data.canvasWidth ?? null,
    },
  });

  return NextResponse.json(block);
}
