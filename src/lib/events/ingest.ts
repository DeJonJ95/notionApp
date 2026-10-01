import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildIndex } from './match';
import { normalizeName, plusOneHost, replacedPlusOnes } from './names';
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
      select: { personId: true, attended: true, person: { select: { name: true } } },
    }),
  ]);
  const placeholders = new Map(existing.map((a) => [normalizeName(a.person.name), a.personId]));
  const checkedIn = new Set(existing.filter((a) => a.attended).map((a) => normalizeName(a.person.name)));
  const contacts = new Map(people.map((p) => [p.id, p.contact]));
  return { index: buildIndex(people), placeholders, checkedIn, contacts };
}

type Ctx = Awaited<ReturnType<typeof loadContext>> & {
  ownerId: string;
  replaced: Set<string>;
  created: NewPerson[];
  contactUpdates: { id: string; contact: string }[];
};

function findOrCreate(ctx: Ctx, name: string, row: GuestRow, isPlusOne: boolean): string {
  const existing = isPlusOne ? ctx.placeholders.get(normalizeName(name)) ?? null : ctx.index.find(name, row.contact);
  if (existing) {
    if (row.contact && !ctx.contacts.get(existing)) {
      ctx.contactUpdates.push({ id: existing, contact: row.contact.slice(0, 120) });
      ctx.contacts.set(existing, row.contact);
    }
    return existing;
  }
  const id = randomUUID();
  ctx.created.push({ id, ownerId: ctx.ownerId, name, contact: row.contact?.slice(0, 120) ?? null, isPlaceholder: isPlusOne });
  if (isPlusOne) ctx.placeholders.set(normalizeName(name), id);
  else ctx.index.add(id, name, row.contact);
  return id;
}

function resolveRow(ctx: Ctx, row: GuestRow): Resolved | null {
  const name = row.name.trim().slice(0, 120);
  if (!name) return null;
  const host = plusOneHost(name);
  const hostName = row.plusOneOf ?? host ?? undefined;
  const personId = findOrCreate(ctx, name, row, !!host);
  // A +1 checked in at the door before they had a name stays checked in.
  const slot = hostName && !host ? normalizeName(`${hostName}'s +1`) : '';
  const carried = slot && ctx.replaced.has(slot) && ctx.checkedIn.has(slot) ? { ...row, attended: true } : row;
  return { row: carried, personId, guestOfId: hostName ? ctx.index.find(hostName) : null };
}

/** Link every row to a Person (matching by contact, then by any known
 *  spelling) and upsert its Attendance for the event. Re-importing the same
 *  list updates rows in place instead of duplicating them. */
export async function ingestGuests(ownerId: string, eventId: string, rows: GuestRow[]) {
  const loaded = await loadContext(ownerId, eventId);
  const replaced = new Set(replacedPlusOnes(rows, loaded.placeholders.keys()));
  const dropIds = Array.from(replaced, (key) => loaded.placeholders.get(key)).filter((id): id is string => !!id);
  const ctx: Ctx = { ...loaded, ownerId, replaced, created: [], contactUpdates: [] };
  const resolved = rows.map((r) => resolveRow(ctx, r)).filter((r): r is Resolved => r !== null);

  await prisma.person.createMany({ data: ctx.created });
  await prisma.$transaction([
    ...ctx.contactUpdates.map((u) => prisma.person.update({ where: { id: u.id }, data: { contact: u.contact } })),
    ...resolved.map((r) => upsertAttendance(eventId, r)),
    prisma.person.deleteMany({ where: { id: { in: dropIds }, ownerId, isPlaceholder: true } }),
  ]);
  return { people: ctx.created.filter((p) => !p.isPlaceholder).length, guests: resolved.length };
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
