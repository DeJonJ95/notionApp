import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findOrCreateBudgetDb } from '@/lib/budgetDb';

// Rename the account stamped on transactions and import logs. Renaming onto a
// name that already exists merges the two, which is the repair path for typing
// a different label into the import dialog than the one already being tracked.

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const from = String(body.from ?? '').trim();
  const to = String(body.to ?? '').trim().slice(0, 80);
  if (!from) return NextResponse.json({ error: 'from required' }, { status: 400 });
  if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });
  if (from === to) return NextResponse.json({ ok: true, transactions: 0, imports: 0, merged: false });

  try {
    const db = await findOrCreateBudgetDb(userId);
    const accountProp = db.properties.find((p) => p.name === 'Account');
    if (!accountProp) {
      return NextResponse.json({ error: 'This budget database has no Account property' }, { status: 400 });
    }

    // Filter in JS rather than by JSON equality — PropertyValue.value is Json,
    // and every other read in this codebase resolves it the same way.
    const values = await prisma.propertyValue.findMany({
      where: { propertyId: accountProp.id, page: { databaseId: db.id, isArchived: false } },
      select: { id: true, value: true },
    });
    const ids = values.filter((v) => String(v.value ?? '') === from).map((v) => v.id);

    // Does the target already exist? Then this is a merge, not a rename.
    const merged = values.some((v) => String(v.value ?? '') === to);

    if (ids.length > 0) {
      await prisma.propertyValue.updateMany({ where: { id: { in: ids } }, data: { value: to } });
    }
    const imports = await prisma.importLog.updateMany({
      where: { userId, account: from },
      data: { account: to },
    });

    return NextResponse.json({
      ok: true,
      transactions: ids.length,
      imports: imports.count,
      merged,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
