import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { dueProperty, isDoneStatus, selectOptions, statusProperty } from '@/lib/agenda';

const schema = z.object({
  databaseId: z.string(),
  title: z.string().trim().min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourcePageId: z.string().optional(),
});

function sourceDoc(sourcePageId: string, sourceTitle: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Promoted from ' },
          {
            type: 'text',
            text: sourceTitle,
            marks: [{ type: 'link', attrs: { href: `/page/${sourcePageId}`, target: null } }],
          },
        ],
      },
    ],
  };
}

// Creates one database row from a journal to-do: title, due date on the
// database's due property, first non-done Status option, and a block that
// links back to the journal page it came from.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { databaseId, title, dueDate, sourcePageId } = parsed.data;

  const db = await prisma.database.findFirst({
    where: { id: databaseId, workspace: { ownerId: userId } },
    include: { properties: { select: { id: true, name: true, type: true, formula: true } } },
  });
  if (!db) return NextResponse.json({ error: 'Database not found' }, { status: 404 });

  const source = sourcePageId
    ? await prisma.page.findFirst({ where: { id: sourcePageId, authorId: userId }, select: { id: true, title: true } })
    : null;

  const last = await prisma.page.findFirst({
    where: { databaseId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const values: { propertyId: string; value: string }[] = [];
  const due = dueProperty(db.properties);
  if (due && dueDate) values.push({ propertyId: due.id, value: dueDate });
  const status = statusProperty(db.properties);
  const firstOpen = selectOptions(status).find((o) => !isDoneStatus(o));
  if (status && firstOpen) values.push({ propertyId: status.id, value: firstOpen });

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        workspaceId: db.workspaceId,
        databaseId,
        title,
        authorId: userId,
        position: (last?.position ?? 0) + 1024,
      },
    });
    if (values.length) {
      await tx.propertyValue.createMany({ data: values.map((v) => ({ ...v, pageId: created.id })) });
    }
    if (source) {
      await tx.block.create({
        data: { pageId: created.id, type: 'document', position: 0, content: sourceDoc(source.id, source.title) },
      });
    }
    return created;
  });

  return NextResponse.json({ id: page.id, title: page.title, databaseId, databaseName: db.name });
}
