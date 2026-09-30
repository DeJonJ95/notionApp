import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';

/** Body: `{ keepId, mergeId }`. Moves mergeId's history onto keepId, keeps
 *  its name as an alias, then deletes it. Where both were at one event the
 *  kept row wins and absorbs the check-in. */
export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const ids = [body?.keepId, body?.mergeId];
  if (ids.some((v) => typeof v !== 'string') || ids[0] === ids[1]) {
    return NextResponse.json({ error: 'keepId and mergeId required' }, { status: 400 });
  }
  const people = await prisma.person.findMany({
    where: { id: { in: ids }, ownerId: userId },
    include: { attendances: true },
  });
  const keep = people.find((p) => p.id === ids[0]);
  const gone = people.find((p) => p.id === ids[1]);
  if (!keep || !gone) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const keptEvents = new Map(keep.attendances.map((a) => [a.eventId, a]));
  const aliases = Array.from(new Set([...keep.aliases, ...gone.aliases, ...(gone.isPlaceholder ? [] : [gone.name])]));
  await prisma.$transaction([
    ...gone.attendances.map((a) => {
      const clash = keptEvents.get(a.eventId);
      if (!clash) return prisma.attendance.update({ where: { id: a.id }, data: { personId: keep.id } });
      return prisma.attendance.update({
        where: { id: clash.id },
        data: { attended: clash.attended || a.attended, rsvp: clash.rsvp ?? a.rsvp, source: clash.source ?? a.source },
      });
    }),
    prisma.attendance.updateMany({ where: { guestOfId: gone.id }, data: { guestOfId: keep.id } }),
    prisma.person.update({
      where: { id: keep.id },
      data: { aliases: aliases.filter((a) => a !== keep.name), contact: keep.contact ?? gone.contact, isPlaceholder: keep.isPlaceholder && gone.isPlaceholder },
    }),
    prisma.person.delete({ where: { id: gone.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
