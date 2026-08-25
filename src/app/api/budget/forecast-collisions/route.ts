import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  findLedgerDuplicates,
  isRecurringGeneratedNote,
  type LedgerDuplicate,
} from '@/lib/budgetDb';

// Recurring forecast rows that the real transaction has landed on top of.
// Normally prevented at the source (the engine skips import-covered dates, and
// an import supersedes forecasts in its range), but rows written before those
// guards existed still need clearing, and this also catches any that slip past.

export type ForecastCollisionsPayload = {
  collisions: LedgerDuplicate[];
};

async function loadRows(databaseId: string) {
  const pages = await prisma.page.findMany({
    where: { databaseId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    include: { properties: { include: { property: { select: { name: true } } } } },
  });

  const rows: {
    pageId: string;
    date: string;
    vendor: string;
    amount: number;
    isGenerated: boolean;
  }[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') continue;
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    rows.push({
      pageId: p.id,
      date: String(vals['Date'] ?? '').slice(0, 10),
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      isGenerated: isRecurringGeneratedNote(vals['Notes']),
    });
  }
  return rows;
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = await findOrCreateBudgetDb(userId);
    const payload: ForecastCollisionsPayload = {
      collisions: findLedgerDuplicates(await loadRows(db.id)),
    };
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

/** Archive the forecast rows. Recomputed server-side rather than trusting the
 *  client's page ids, so a stale tab can't archive a real transaction. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body?.pageIds) ? body.pageIds.map(String) : [];

  try {
    const db = await findOrCreateBudgetDb(userId);
    const collisions = findLedgerDuplicates(await loadRows(db.id));
    const removable = new Set(collisions.map((c) => c.pageId));
    // An empty/absent list means "all of them".
    const ids = requested.length > 0 ? requested.filter((id) => removable.has(id)) : [...removable];

    if (ids.length > 0) {
      await prisma.page.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } });
    }
    return NextResponse.json({ ok: true, removed: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
