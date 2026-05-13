import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { ResolvedChange } from '../route';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { changes } = await req.json() as { changes: ResolvedChange[] };
  if (!Array.isArray(changes) || changes.length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  // Verify the user owns all referenced databases before applying anything
  const databaseIds = [...new Set(changes.map((c) => c.databaseId))];
  const owned = await prisma.database.findMany({
    where: { id: { in: databaseIds }, workspace: { ownerId: userId } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((d) => d.id));

  const results: Array<{ ok: boolean; action: string; detail: string }> = [];

  for (const change of changes) {
    if (!ownedIds.has(change.databaseId)) {
      results.push({ ok: false, action: change.action, detail: 'Unauthorized database' });
      continue;
    }

    try {
      if (change.action === 'update') {
        // Upsert each changed property value
        for (const [propName, rawValue] of Object.entries(change.changes)) {
          const prop = change.propertyMap[propName];
          if (!prop) continue;

          await prisma.propertyValue.upsert({
            where: { propertyId_pageId: { propertyId: prop.id, pageId: change.pageId } },
            update: { value: rawValue as any },
            create: { propertyId: prop.id, pageId: change.pageId, value: rawValue as any },
          });
        }

        // If "Name" (title) is in changes, update the page title too
        if ('Name' in change.changes) {
          await prisma.page.update({
            where: { id: change.pageId },
            data: { title: String(change.changes['Name']) },
          });
        }

        results.push({ ok: true, action: 'update', detail: `Updated "${change.pageTitle}"` });
      } else if (change.action === 'create') {
        const title = change.row['Name'] ? String(change.row['Name']) : 'Untitled';

        // Get max position for new row
        const last = await prisma.page.findFirst({
          where: { databaseId: change.databaseId, isArchived: false },
          orderBy: { position: 'desc' },
          select: { position: true },
        });

        const page = await prisma.page.create({
          data: {
            title,
            workspaceId: change.workspaceId,
            databaseId: change.databaseId,
            authorId: userId,
            position: (last?.position ?? 0) + 1024,
          },
        });

        // Set property values for all other columns
        for (const [propName, rawValue] of Object.entries(change.row)) {
          if (propName === 'Name') continue;
          const prop = change.propertyMap[propName];
          if (!prop) continue;

          await prisma.propertyValue.create({
            data: { propertyId: prop.id, pageId: page.id, value: rawValue as any },
          });
        }

        results.push({ ok: true, action: 'create', detail: `Created "${title}"` });
      }
    } catch (err) {
      console.error('Apply change error:', err);
      results.push({ ok: false, action: change.action, detail: String(err) });
    }
  }

  return NextResponse.json({ results });
}
