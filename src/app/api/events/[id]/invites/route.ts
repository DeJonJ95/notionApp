import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';
import { suggestInvites } from '@/lib/events/suggest';
import { duplicateReason } from '@/lib/events/match';

type Ctx = { params: { id: string } };

async function context(eventId: string) {
  const userId = await currentUserId();
  if (!userId) return null;
  const event = await prisma.event.findFirst({
    where: { id: eventId, ownerId: userId },
    select: {
      id: true,
      date: true,
      attendances: { select: { personId: true, person: { select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true } } } },
    },
  });
  return event ? { userId, event } : null;
}

/** Query: `from` (comma-separated event ids; default the latest earlier
 *  event), `include` (came | came-or-rsvped), `maxNoShows` (blank = any). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ctx = await context(params.id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const q = req.nextUrl.searchParams;
  const events = await prisma.event.findMany({
    where: { ownerId: ctx.userId, id: { not: params.id } },
    orderBy: { date: 'desc' },
    select: { id: true, name: true, date: true },
  });
  const earlier = events.find((e) => e.date < ctx.event.date) ?? events[0];
  const from = q.get('from')?.split(',').filter(Boolean) ?? (earlier ? [earlier.id] : []);
  const maxRaw = q.get('maxNoShows');
  const rules = {
    fromEventIds: from,
    include: q.get('include') === 'came-or-rsvped' ? ('came-or-rsvped' as const) : ('came' as const),
    maxNoShows: maxRaw === null || maxRaw === '' ? null : Number(maxRaw),
  };

  const history = await prisma.attendance.findMany({
    where: { person: { ownerId: ctx.userId, isPlaceholder: false }, eventId: { not: params.id } },
    select: { personId: true, eventId: true, rsvp: true, attended: true, event: { select: { date: true, fullCheckIn: true } } },
  });
  const suggestions = suggestInvites(
    history.map((h) => ({ ...h, eventDate: h.event.date, fullCheckIn: h.event.fullCheckIn })),
    rules,
    new Set(ctx.event.attendances.map((a) => a.personId)),
  );
  const people = await prisma.person.findMany({
    where: { id: { in: suggestions.map((s) => s.personId) } },
    select: { id: true, name: true, aliases: true, contact: true, isPlaceholder: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const listed = ctx.event.attendances.map((a) => a.person).filter((p) => !p.isPlaceholder);
  // Someone listed under another spelling ("Deciah" vs "Deciah Mahone") is
  // flagged so they aren't invited twice before the host merges them.
  const listedAs = (id: string) => {
    const p = byId.get(id);
    return p ? listed.find((l) => duplicateReason(p, l))?.name ?? null : null;
  };
  return NextResponse.json({
    events,
    from,
    suggestions: suggestions.map((s) => ({ ...s, person: byId.get(s.personId), maybeListedAs: listedAs(s.personId) })),
  });
}

const postSchema = z.object({ personIds: z.array(z.string()).min(1).max(1000) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const ctx = await context(params.id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pick at least one person' }, { status: 400 });
  const owned = await prisma.person.findMany({
    where: { id: { in: parsed.data.personIds }, ownerId: ctx.userId },
    select: { id: true },
  });
  const { count } = await prisma.attendance.createMany({
    data: owned.map((p) => ({ eventId: params.id, personId: p.id, rsvp: 'invited', source: 'text' })),
    skipDuplicates: true,
  });
  return NextResponse.json({ added: count });
}
