import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { buildIndex } from './match';

const BURST_LIMIT = 30;

/** Self check-in from the door QR code. Finds the guest by contact first,
 *  then by name; anyone unknown becomes a new Person tagged as a QR walk-in.
 *  A contact typed for an existing guest is held on the attendance for the
 *  host to confirm, since anyone with the link could type any name. */
export async function selfCheckIn(event: { id: string; ownerId: string }, name: string, contact: string | null) {
  const people = await prisma.person.findMany({
    where: { ownerId: event.ownerId },
    select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true },
  });
  let personId = buildIndex(people).find(name, contact);
  const known = people.find((p) => p.id === personId);
  if (!personId) {
    personId = randomUUID();
    await prisma.person.create({ data: { id: personId, ownerId: event.ownerId, name, contact } });
  }
  const pending = known && contact && contact !== known.contact ? contact : null;
  const now = new Date();
  await prisma.attendance.upsert({
    where: { eventId_personId: { eventId: event.id, personId } },
    update: { attended: true, checkedInAt: now, ...(pending ? { contactGiven: pending } : {}) },
    create: { eventId: event.id, personId, attended: true, checkedInAt: now, source: 'qr', contactGiven: pending },
  });
}

/** More than BURST_LIMIT QR check-ins in a minute is a script, not a door. */
export async function tooManyCheckIns(eventId: string): Promise<boolean> {
  const recent = await prisma.attendance.count({
    where: { eventId, source: 'qr', createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  return recent >= BURST_LIMIT;
}
