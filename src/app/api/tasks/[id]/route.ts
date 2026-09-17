import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveTaskWrite, taskSchema } from '@/lib/agenda';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { done?: unknown; status?: unknown } | null;
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId, databaseId: { not: null } },
    select: {
      id: true,
      database: { select: { properties: { select: { id: true, name: true, type: true, formula: true } } } },
    },
  });
  if (!page?.database) return NextResponse.json({ error: 'Not a database row' }, { status: 404 });

  const write = resolveTaskWrite(body, taskSchema(page.database.properties));
  if ('error' in write) {
    return NextResponse.json({ updated: false, error: write.error }, { status: write.code });
  }

  await prisma.propertyValue.upsert({
    where: { propertyId_pageId: { propertyId: write.propertyId, pageId: page.id } },
    update: { value: write.value },
    create: { ...write, pageId: page.id },
  });
  return NextResponse.json({ updated: true, value: write.value });
}
