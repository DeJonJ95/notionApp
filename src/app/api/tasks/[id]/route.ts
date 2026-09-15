import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isDoneStatus, selectOptions, taskSchema } from '@/lib/agenda';

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

  const { status, done } = taskSchema(page.database.properties);
  const options = selectOptions(status);
  const target = body.done ? options.find(isDoneStatus) : options.find((o) => !isDoneStatus(o));

  const write = status && target
    ? { propertyId: status.id, value: target }
    : done
      ? { propertyId: done.id, value: body.done }
      : null;
  if (!write) {
    return NextResponse.json(
      { updated: false, error: 'This database has no Complete/Done status option or Done checkbox' },
      { status: 409 }
    );
  }

  await prisma.propertyValue.upsert({
    where: { propertyId_pageId: { propertyId: write.propertyId, pageId: page.id } },
    update: { value: write.value },
    create: { ...write, pageId: page.id },
  });
  return NextResponse.json({ updated: true, value: write.value });
}
