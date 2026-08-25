import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  checkImportBalances,
  type ImportBalanceCheck,
} from '@/lib/budgetDb';

export type ImportLogEntry = {
  id: string;
  filename: string;
  dateFrom: string;
  dateTo: string;
  txCount: number;
  createdAt: string;
};

export type ImportsPayload = {
  imports: ImportLogEntry[];
  lastImportDate: string | null;
  daysSinceLastImport: number | null;
  gaps: { from: string; to: string; days: number }[];
  // Statements whose own opening/closing balances don't match what was imported
  balanceChecks: ImportBalanceCheck[];
};

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const logs = await prisma.importLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const entries: ImportLogEntry[] = logs.map((l) => ({
    id: l.id,
    filename: l.filename,
    dateFrom: l.dateFrom.toISOString().slice(0, 10),
    dateTo: l.dateTo.toISOString().slice(0, 10),
    txCount: l.txCount,
    createdAt: l.createdAt.toISOString().slice(0, 10),
  }));

  const now = new Date();
  let lastImportDate: string | null = null;
  let daysSinceLastImport: number | null = null;

  if (entries.length > 0) {
    const last = logs[0];
    lastImportDate = last.createdAt.toISOString().slice(0, 10);
    const diffMs = now.getTime() - last.createdAt.getTime();
    daysSinceLastImport = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Compute coverage gaps: gaps > 3 days between import date ranges
  const gaps: { from: string; to: string; days: number }[] = [];
  if (entries.length >= 2) {
    // Sort chronologically ascending for gap detection
    const sorted = [...logs].sort(
      (a, b) => a.dateFrom.getTime() - b.dateFrom.getTime()
    );
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].dateTo;
      const currStart = sorted[i].dateFrom;
      const gapMs = currStart.getTime() - prevEnd.getTime();
      const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24)) - 1;
      if (gapDays > 3) {
        gaps.push({
          from: new Date(prevEnd.getTime() + 86400000).toISOString().slice(0, 10),
          to: new Date(currStart.getTime() - 86400000).toISOString().slice(0, 10),
          days: gapDays,
        });
      }
    }
  }

  // Reconcile each statement against its own printed balances. Best-effort:
  // a failure here must not stop the coverage list from rendering.
  let balanceChecks: ImportBalanceCheck[] = [];
  try {
    const db = await findOrCreateBudgetDb(userId);
    const pages = await prisma.page.findMany({
      where: { databaseId: db.id, isArchived: false },
      include: { properties: { include: { property: { select: { name: true } } } } },
    });
    const transactions: { account?: string | null; date: string; amount: number }[] = [];
    for (const p of pages) {
      const vals: Record<string, any> = {};
      for (const pv of p.properties) vals[pv.property.name] = pv.value;
      const type = String(vals['Type'] ?? '');
      if (type === 'Budget') continue;
      const rawAmt = Number(vals['Amount'] ?? 0);
      if (!rawAmt) continue;
      transactions.push({
        account: vals['Account'] == null ? null : String(vals['Account']),
        date: String(vals['Date'] ?? '').slice(0, 10),
        amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      });
    }
    balanceChecks = checkImportBalances(logs, transactions);
  } catch (e) {
    console.warn('[budget-imports] balance check skipped:', (e as Error).message);
  }

  const payload: ImportsPayload = {
    imports: entries,
    lastImportDate,
    daysSinceLastImport,
    gaps,
    balanceChecks,
  };

  return NextResponse.json(payload);
}