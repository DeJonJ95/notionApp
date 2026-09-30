import { prisma } from '@/lib/prisma';
import { duplicateReason } from './match';

/** The event page's data: every guest plus their history before this date,
 *  and, for anyone who looks new, existing people who may be the same human. */
export async function loadEventView(eventId: string, ownerId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, ownerId },
    include: {
      attendances: {
        include: {
          person: { select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true } },
          guestOf: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!event) return null;
  const ids = event.attendances.map((a) => a.personId);
  const [prior, people] = await Promise.all([
    prisma.attendance.findMany({
      where: { personId: { in: ids }, event: { date: { lt: event.date } } },
      select: { personId: true, attended: true, rsvp: true },
    }),
    prisma.person.findMany({
      where: { ownerId, isPlaceholder: false },
      select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true, _count: { select: { attendances: { where: { attended: true } } } } },
    }),
  ]);
  const came = new Map<string, number>();
  const missed = new Map<string, number>();
  for (const p of prior) {
    if (p.attended) came.set(p.personId, (came.get(p.personId) ?? 0) + 1);
    else if (p.rsvp === 'going') missed.set(p.personId, (missed.get(p.personId) ?? 0) + 1);
  }
  const onList = new Set(ids);
  const veterans = people.filter((p) => p._count.attendances > 0 && !onList.has(p.id));

  return {
    ...event,
    attendances: event.attendances.map((a) => {
      const cameBefore = came.get(a.personId) ?? 0;
      const maybeSame = cameBefore || a.person.isPlaceholder
        ? []
        : veterans.filter((v) => duplicateReason(a.person, v)).slice(0, 3).map((v) => ({ id: v.id, name: v.name }));
      return { ...a, cameBefore, missedBefore: missed.get(a.personId) ?? 0, maybeSame };
    }),
  };
}
