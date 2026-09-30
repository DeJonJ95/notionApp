import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';
import { ingestGuests } from '@/lib/events/ingest';
import { parseGuestText, type GuestRow } from '@/lib/events/guestRows';

const MAX_ROWS = 1000;

/** Body: `{ text, source? }` for a CSV or pasted list, or `{ rows }` for
 *  rows the client already built (a walk-in added at the door). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const event = await prisma.event.findFirst({ where: { id: params.id, ownerId: userId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const rows: GuestRow[] =
    typeof body?.text === 'string'
      ? parseGuestText(body.text, typeof body.source === 'string' ? body.source : undefined).rows
      : Array.isArray(body?.rows)
        ? body.rows.filter((r: GuestRow) => typeof r?.name === 'string')
        : [];
  if (rows.length === 0) return NextResponse.json({ error: 'No guests found' }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Max ${MAX_ROWS} guests per import` }, { status: 400 });

  return NextResponse.json(await ingestGuests(userId, event.id, rows));
}
