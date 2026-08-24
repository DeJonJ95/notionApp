import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  writeTransactions,
  findDuplicateTransactions,
  isRecurringGeneratedNote,
  type ParsedTransaction,
} from '@/lib/budgetDb';

/** A statement is the record of what actually happened in its period, so any
 *  forecast row the recurring engine wrote inside that window is superseded.
 *  Archive those before deduping, otherwise the real paycheck lands alongside
 *  the predicted one and the month is counted twice.
 *  Only rows carrying the engine's own Notes marker are touched — never a
 *  transaction the user or a previous import created. */
async function supersedeGeneratedRows(
  databaseId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  const pages = await prisma.page.findMany({
    where: { databaseId, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
  });

  const ids: string[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    if (String(vals['Type'] ?? '') === 'Budget') continue;
    if (!isRecurringGeneratedNote(vals['Notes'])) continue;
    const d = String(vals['Date'] ?? '').slice(0, 10);
    if (d >= dateFrom && d <= dateTo) ids.push(p.id);
  }

  if (ids.length > 0) {
    await prisma.page.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } });
  }
  return ids.length;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { databaseId, transactions, force, account, meta } = (await req.json()) as {
    databaseId: string;
    transactions: ParsedTransaction[];
    force?: boolean;
    account?: string;
    meta?: { account?: string | null; openingBalance?: number | null; closingBalance?: number | null };
  };

  if (!databaseId || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'databaseId and transactions required' }, { status: 400 });
  }

  // The account the user confirmed in the preview wins over what the AI read.
  const accountName = String(account ?? meta?.account ?? '').trim().slice(0, 80);
  const numOrNull = (v: unknown) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const stamped: ParsedTransaction[] = accountName
    ? transactions.map((t) => ({ ...t, account: accountName }))
    : transactions;

  // Date span this statement covers, needed before the dedup check.
  const sortedDates = transactions
    .map((t) => String(t.date ?? '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  try {
    // ── Supersede recurring forecasts in this statement's range ────────────
    // Runs BEFORE dedup so the incoming rows are compared against real
    // transactions only, and runs even when the user ends up skipping
    // everything as a duplicate — the forecasts are stale either way.
    let superseded = 0;
    if (sortedDates.length > 0) {
      const owned = await prisma.database.findFirst({
        where: { id: databaseId, workspace: { ownerId: userId } },
        select: { id: true },
      });
      if (owned) {
        superseded = await supersedeGeneratedRows(
          owned.id,
          sortedDates[0],
          sortedDates[sortedDates.length - 1],
        );
      }
    }

    // ── Cross-import dedup check ───────────────────────────────────────────
    if (!force) {
      // Load existing transactions from the budget DB for duplicate matching
      const db = await prisma.database.findFirst({
        where: { id: databaseId, workspace: { ownerId: userId } },
        include: { properties: true },
      });
      if (db) {
        const pages = await prisma.page.findMany({
          where: { databaseId: db.id, isArchived: false },
          include: { properties: { include: { property: { select: { name: true } } } } },
        });
        const existing: { date: string; vendor: string; amount: number }[] = [];
        for (const p of pages) {
          const vals: Record<string, any> = {};
          for (const pv of p.properties) vals[pv.property.name] = pv.value;
          const type = String(vals['Type'] ?? '');
          if (type === 'Budget') continue;
          const rawAmt = Number(vals['Amount'] ?? 0);
          if (!rawAmt) continue;
          existing.push({
            date: String(vals['Date'] ?? '').slice(0, 10),
            vendor: String(vals['Vendor'] ?? p.title ?? ''),
            amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
          });
        }
        const duplicates = findDuplicateTransactions(existing, transactions);
        if (duplicates.length > 0) {
          return NextResponse.json({ duplicates, created: 0, superseded });
        }
      }
    }

    // ── Write transactions ─────────────────────────────────────────────────
    const result = await writeTransactions(userId, databaseId, stamped);

    // ── Create ImportLog entry ─────────────────────────────────────────────
    const dates = transactions
      .map((t) => new Date(t.date + 'T00:00:00'))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    if (dates.length > 0) {
      await prisma.importLog.create({
        data: {
          userId,
          filename: `import-${dates[0].toISOString().slice(0, 10)}-to-${dates[dates.length - 1].toISOString().slice(0, 10)}`,
          dateFrom: dates[0],
          dateTo: dates[dates.length - 1],
          txCount: transactions.length,
          account: accountName || null,
          openingBalance: numOrNull(meta?.openingBalance),
          closingBalance: numOrNull(meta?.closingBalance),
        },
      });
    }

    return NextResponse.json({ ...result, duplicates: [], superseded });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
  }
}