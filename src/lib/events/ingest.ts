import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildIndex } from './match';
import { normalizeName, plusOneHost } from './names';
import type { GuestRow } from './guestRows';

type Resolved = { row: GuestRow; personId: string; guestOfId: string | null };
type NewPerson = { id: string; ownerId: string; name: string; contact: string | null; isPlaceholder: boolean };

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw.trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? undefined : d;
}

async function loadContext(ownerId: string, eventId: string) {
  const [people, existing] = await Promise.all([
    prisma.person.findMany({
      where: { ownerId },
      select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true },
    }),
    prisma.attendance.findMany({
      where: { eventId, person: { isPlaceholder: true } },
      select: { personId: true, person: { select: { name: true } } },
    }),
  ]);
  const placeholders = new Map(existing.map((a) => [normalizeName(a.person.name), a.personId]));
  const contacts = new Map(people.map((p) => [p.id, p.contact]));
  return { index: buildIndex(people), placeholders, contacts };
}

/** Link every row to a Person (matching by contact, then by any known
 *  spelling) and upsert its Attendance for the event. Re-importing the same
 *  list updates rows in place instead of duplicating them. */
export async function ingestGuests(ownerId: string, eventId: string, rows: GuestRow[]) {
  const { index, placeholders, contacts } = await loadContext(ownerId, eventId);
  const created: NewPerson[] = [];
  const contactUpdates: { id: string; contact: string }[] = [];
  const resolved: Resolved[] = [];

  for (const row of rows) {
    const name = row.name.trim().slice(0, 120);
    if (!name) continue;
    const host = plusOneHost(name);
    const hostName = row.plusOneOf ?? host ?? undefined;
    let personId = host ? placeholders.get(normalizeName(name)) ?? null : index.find(name, row.contact);
    if (!personId) {
      personId = randomUUID();
      created.push({ id: personId, ownerId, name, contact: row.contact?.slice(0, 120) ?? null, isPlaceholder: !!host });
      if (host) placeholders.set(normalizeName(name), personId);
      else index.add(personId, name, row.contact);
    } else if (row.contact && !contacts.get(personId)) {
      contactUpdates.push({ id: personId, contact: row.contact.slice(0, 120) });
      contacts.set(personId, row.contact);
    }
    resolved.push({ row, personId, guestOfId: hostName ? index.find(hostName) : null });
  }

  await prisma.person.createMany({ data: created });
  await prisma.$transaction([
    ...contactUpdates.map((u) => prisma.person.update({ where: { id: u.id }, data: { contact: u.contact } })),
    ...resolved.map((r) => upsertAttendance(eventId, r)),
  ]);
  return { people: created.filter((p) => !p.isPlaceholder).length, guests: resolved.length };
}

function upsertAttendance(eventId: string, { row, personId, guestOfId }: Resolved) {
  const fields: Prisma.AttendanceUncheckedUpdateInput = {};
  if (row.rsvp) fields.rsvp = row.rsvp;
  const rsvpAt = parseDate(row.rsvpAt);
  if (rsvpAt) fields.rsvpAt = rsvpAt;
  if (row.attended !== undefined) {
    fields.attended = row.attended;
    if (row.attended) fields.checkedInAt = new Date();
  }
  if (row.invitedBy) fields.invitedBy = row.invitedBy.slice(0, 120);
  if (guestOfId) fields.guestOfId = guestOfId;
  return prisma.attendance.upsert({
    where: { eventId_personId: { eventId, personId } },
    update: fields,
    // How someone first reached this event is kept: checking in a Partiful RSVP
    // at the door must not relabel them a walk-in.
    create: { ...(fields as Prisma.AttendanceUncheckedCreateInput), source: row.source ?? null, eventId, personId },
  });
}
