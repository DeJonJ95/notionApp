import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

type Ctx = { params: { id: string } };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  date: z.string().optional(),
  venue: z.string().max(200).nullable().optional(),
  link: z.string().max(500).nullable().optional(),
  checkInOpen: z.boolean().optional(),
});

async function owned(id: string) {
  const userId = await currentUserId();
  if (!userId) return null;
  return prisma.event.findFirst({ where: { id, ownerId: userId }, select: { id: true, ownerId: true } });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!(await owned(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      attendances: {
        include: {
          person: { select: { id: true, name: true, contact: true, isPlaceholder: true } },
          guestOf: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const prior = await prisma.attendance.groupBy({
    by: ['personId'],
    where: { personId: { in: event.attendances.map((a) => a.personId) }, attended: true, event: { date: { lt: event.date } } },
    _count: { _all: true },
  });
  const cameBefore = new Map(prior.map((p) => [p.personId, p._count._all]));
  return NextResponse.json({
    ...event,
    attendances: event.attendances.map((a) => ({ ...a, cameBefore: cameBefore.get(a.personId) ?? 0 })),
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await owned(params.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { date, ...rest } = parsed.data;
  const when = date ? new Date(date) : undefined;
  if (when && isNaN(when.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const event = await prisma.event.update({ where: { id: params.id }, data: { ...rest, ...(when ? { date: when } : {}) } });
  return NextResponse.json(event);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const event = await owned(params.id);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // An unnamed "+1" exists only through its event, so it goes with it.
  await prisma.$transaction([
    prisma.event.delete({ where: { id: params.id } }),
    prisma.person.deleteMany({ where: { ownerId: event.ownerId, isPlaceholder: true, attendances: { none: {} } } }),
  ]);
  return NextResponse.json({ ok: true });
}
