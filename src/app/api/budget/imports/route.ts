import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  checkImportBalances,
  type ImportBalanceCheck,
} from '@/lib/budgetDb';
import { loadLedger } from '@/lib/budgetLedger';
import { statementCoverage, type StatementCoverage } from '@/lib/budgetStatement';

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
  // How far statements reach for the current account, and the holes in between
  coverage: StatementCoverage | null;
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

  const coverage = statementCoverage(
    logs.map((l) => ({ account: l.account, from: l.dateFrom.toISOString().slice(0, 10), to: l.dateTo.toISOString().slice(0, 10) })),
  );

  // Reconcile each statement against its own printed balances. Best-effort:
  // a failure here must not stop the coverage list from rendering.
  let balanceChecks: ImportBalanceCheck[] = [];
  try {
    const db = await findOrCreateBudgetDb(userId);
    const { all } = await loadLedger(db.id);
    balanceChecks = checkImportBalances(logs, all.filter((t) => !t.planned));
  } catch (e) {
    console.warn('[budget-imports] balance check skipped:', (e as Error).message);
  }

  const payload: ImportsPayload = {
    imports: entries,
    lastImportDate,
    daysSinceLastImport,
    coverage,
    balanceChecks,
  };

  return NextResponse.json(payload);
}