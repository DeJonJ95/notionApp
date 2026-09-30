import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

type Ctx = { params: { id: string; attId: string } };

const patchSchema = z.object({
  attended: z.boolean().optional(),
  rsvp: z.enum(['going', 'maybe', 'cant-go', 'invited']).nullable().optional(),
  source: z.enum(['partiful', 'text', 'dm', 'walk-in', 'qr']).nullable().optional(),
});

async function owned(ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return null;
  return prisma.attendance.findFirst({
    where: { id: ctx.params.attId, eventId: ctx.params.id, event: { ownerId: userId } },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await owned(ctx))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { attended, ...rest } = parsed.data;
  const checkIn = attended === undefined ? {} : { attended, checkedInAt: attended ? new Date() : null };
  const row = await prisma.attendance.update({ where: { id: ctx.params.attId }, data: { ...rest, ...checkIn } });
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await owned(ctx))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.attendance.delete({ where: { id: ctx.params.attId } });
  return NextResponse.json({ ok: true });
}
