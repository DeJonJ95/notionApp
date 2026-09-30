import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { buildIndex } from './match';

/** Self check-in from the door QR code. Finds the guest by contact first,
 *  then by name; anyone unknown becomes a new Person tagged as a QR walk-in. */
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
  } else if (contact && !known?.contact) {
    await prisma.person.update({ where: { id: personId }, data: { contact } });
  }
  const now = new Date();
  await prisma.attendance.upsert({
    where: { eventId_personId: { eventId: event.id, personId } },
    update: { attended: true, checkedInAt: now },
    create: { eventId: event.id, personId, attended: true, checkedInAt: now, source: 'qr' },
  });
}
