import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';
import { personStats } from '@/lib/events/stats';
import { possibleDuplicates } from '@/lib/events/match';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const people = await prisma.person.findMany({
    where: { ownerId: userId },
    orderBy: { name: 'asc' },
    include: {
      attendances: { select: { rsvp: true, attended: true, event: { select: { date: true } } } },
      _count: { select: { brought: true } },
    },
  });
  return NextResponse.json({
    people: people.map(({ attendances, _count, ...p }) => ({
      ...p,
      brought: _count.brought,
      ...personStats(attendances.map((a) => ({ eventDate: a.event.date, rsvp: a.rsvp, attended: a.attended }))),
    })),
    duplicates: possibleDuplicates(people),
  });
}
