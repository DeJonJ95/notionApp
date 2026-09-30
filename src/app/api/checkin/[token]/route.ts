import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { selfCheckIn } from '@/lib/events/checkin';

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(120).optional(),
});

// Public: no session. The unguessable token plus the host's open/closed
// switch are the only gate, so the response never exposes guest data.
function findEvent(token: string) {
  return prisma.event.findUnique({
    where: { checkInToken: token },
    select: { id: true, ownerId: true, name: true, date: true, venue: true, checkInOpen: true },
  });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const event = await findEvent(params.token);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ name: event.name, date: event.date, venue: event.venue, open: event.checkInOpen });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const event = await findEvent(params.token);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!event.checkInOpen) return NextResponse.json({ error: 'Check-in is closed' }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter your name' }, { status: 400 });
  await selfCheckIn(event, parsed.data.name, parsed.data.contact || null);
  return NextResponse.json({ ok: true });
}
