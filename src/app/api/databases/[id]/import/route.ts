import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { planImport } from '@/lib/rowImportPlan';
import type { ImportRow } from '@/lib/rowImport';

const MAX_ROWS = 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await prisma.database.findFirst({
    where: { id: params.id, workspace: { ownerId: userId } },
    include: {
      properties: true,
      pages: { where: { isArchived: false }, select: { id: true, title: true, position: true } },
    },
  });
  if (!db) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const defaults: Record<string, string> = body?.defaults && typeof body.defaults === 'object' ? body.defaults : {};
  if (rows.length === 0) return NextResponse.json({ error: 'No rows' }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Max ${MAX_ROWS} rows per import` }, { status: 400 });

  const plan = planImport(db, userId, rows, defaults);
  await prisma.$transaction(plan.ops);
  return NextResponse.json({ created: plan.created, updated: plan.updated, ignoredColumns: plan.ignored });
}
