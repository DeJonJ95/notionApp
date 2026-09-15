import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isDoneStatus, selectOptions, statusProperty } from '@/lib/agenda';

// Flips a database row between done and open. Writes the Status select when
// the database has one (first done-like option, or first open option), and a
// checkbox named Done/Complete when it has that instead. No-op otherwise.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { done?: unknown } | null;
  if (!body || typeof body.done !== 'boolean') {
    return NextResponse.json({ error: 'Expected { done: boolean }' }, { status: 400 });
  }

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId, databaseId: { not: null } },
    select: {
      id: true,
      database: { select: { properties: { select: { id: true, name: true, type: true, formula: true } } } },
    },
  });
  if (!page?.database) return NextResponse.json({ error: 'Not a database row' }, { status: 404 });

  const props = page.database.properties;
  const status = statusProperty(props);
  const options = selectOptions(status);
  const target = body.done ? options.find(isDoneStatus) : options.find((o) => !isDoneStatus(o));
  const checkbox = props.find((p) => p.type === 'checkbox' && /done|complete/i.test(p.name));

  const write = status && target
    ? { propertyId: status.id, value: target }
    : checkbox
      ? { propertyId: checkbox.id, value: body.done }
      : null;
  if (!write) return NextResponse.json({ updated: false });

  await prisma.propertyValue.upsert({
    where: { propertyId_pageId: { propertyId: write.propertyId, pageId: page.id } },
    update: { value: write.value },
    create: { ...write, pageId: page.id },
  });
  return NextResponse.json({ updated: true, value: write.value });
}
