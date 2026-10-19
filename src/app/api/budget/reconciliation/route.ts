import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileTransactions, type ParsedTransaction } from '@/lib/budgetDb';
import type { ReconciliationResult } from '@/lib/budgetDb';
import { loadLedger } from '@/lib/budgetLedger';

export type ReconciliationPayload = {
  dateFrom: string;
  dateTo: string;
  result: ReconciliationResult;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'from and to query params required' }, { status: 400 });
  }

  // Load active recurring rules
  const rules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true },
  });

  // Load transactions in the date range from the budget DB
  const db = await prisma.database.findFirst({
    where: {
      workspace: { ownerId: userId },
      AND: [
        { properties: { some: { name: 'Amount', type: 'number' } } },
        { properties: { some: { name: 'Date', type: 'date' } } },
        { properties: { some: { name: 'Category' } } },
        { properties: { some: { name: 'Vendor' } } },
      ],
    },
    include: { properties: true },
  });

  if (!db) {
    return NextResponse.json({ error: 'Budget database not found' }, { status: 404 });
  }

  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  const { all } = await loadLedger(db.id);
  const transactions: ParsedTransaction[] = all
    .filter((t) => !t.planned && t.date >= dateFrom && t.date <= dateTo)
    .map((t) => ({ date: t.date, vendor: t.vendor, description: t.notes ?? '', amount: t.amount, category: t.category }));

  const result = reconcileTransactions(rules, transactions, dateFrom, dateTo);

  return NextResponse.json({ dateFrom, dateTo, result });
}