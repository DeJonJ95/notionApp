import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: z.string().min(1),
  venue: z.string().max(200).optional(),
  link: z.string().max(500).optional(),
});

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const events = await prisma.event.findMany({
    where: { ownerId: userId },
    orderBy: { date: 'desc' },
    include: { attendances: { select: { attended: true, rsvp: true } } },
  });
  return NextResponse.json(
    events.map(({ attendances, ...e }) => ({
      ...e,
      guests: attendances.length,
      going: attendances.filter((a) => a.rsvp === 'going').length,
      attended: attendances.filter((a) => a.attended).length,
    })),
  );
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Name and date required' }, { status: 400 });
  const date = new Date(parsed.data.date);
  if (isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const event = await prisma.event.create({ data: { ...parsed.data, date, ownerId: userId } });
  return NextResponse.json(event, { status: 201 });
}
