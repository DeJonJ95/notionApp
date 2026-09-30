import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentUserId } from '@/lib/events/session';
import { ingestGuests } from '@/lib/events/ingest';
import { guestRowsFromDatabase } from '@/lib/events/fromDatabase';

/** Databases made from the Guest List template, recognised by their
 *  Attended column, for the "copy from database" picker. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbs = await prisma.database.findMany({
    where: { workspace: { ownerId: userId }, properties: { some: { name: 'Attended' } } },
    select: { id: true, name: true, _count: { select: { pages: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(dbs.map((d) => ({ id: d.id, name: d.name, rows: d._count.pages })));
}

/** Body: `{ databaseId, nextEventId? }`. Copies a Guest List database into
 *  this event; its "Sunday Invite" column lands on `nextEventId` when given. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const databaseId = typeof body?.databaseId === 'string' ? body.databaseId : '';
  const nextEventId = typeof body?.nextEventId === 'string' ? body.nextEventId : '';

  const [event, next, db] = await Promise.all([
    prisma.event.findFirst({ where: { id: params.id, ownerId: userId }, select: { id: true } }),
    nextEventId ? prisma.event.findFirst({ where: { id: nextEventId, ownerId: userId }, select: { id: true } }) : null,
    prisma.database.findFirst({
      where: { id: databaseId, workspace: { ownerId: userId } },
      select: {
        pages: {
          where: { isArchived: false },
          orderBy: { position: 'asc' },
          select: { title: true, properties: { select: { value: true, property: { select: { name: true } } } } },
        },
      },
    }),
  ]);
  if (!event || !db || (nextEventId && !next)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { rows, next: nextRows } = guestRowsFromDatabase(
    db.pages.map((p) => ({ title: p.title, values: Object.fromEntries(p.properties.map((v) => [v.property.name, v.value])) })),
  );
  const result = await ingestGuests(userId, event.id, rows);
  const invited = next && nextRows.length ? (await ingestGuests(userId, next.id, nextRows)).guests : 0;
  return NextResponse.json({ ...result, invited });
}
