import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

/** Raw rows for the metrics page; the numbers are computed client-side so
 *  times bucket in the viewer's timezone. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [events, rows, people] = await Promise.all([
    prisma.event.findMany({ where: { ownerId: userId }, orderBy: { date: 'asc' }, select: { id: true, name: true, date: true, fullCheckIn: true } }),
    prisma.attendance.findMany({
      where: { event: { ownerId: userId } },
      select: {
        eventId: true, personId: true, rsvp: true, rsvpAt: true, attended: true, checkedInAt: true,
        invitedAt: true, source: true, guestOfId: true, person: { select: { isPlaceholder: true } },
      },
    }),
    prisma.person.findMany({ where: { ownerId: userId, isPlaceholder: false }, select: { id: true, name: true, contact: true } }),
  ]);
  return NextResponse.json({
    events,
    rows: rows.map(({ person, ...r }) => ({ ...r, isPlaceholder: person.isPlaceholder })),
    people,
  });
}
