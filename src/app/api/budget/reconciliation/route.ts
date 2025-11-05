import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileTransactions, type ParsedTransaction } from '@/lib/budgetDb';
import type { ReconciliationResult } from '@/lib/budgetDb';

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

  const pages = await prisma.page.findMany({
    where: { databaseId: db.id, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
  });

  const transactions: ParsedTransaction[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') continue;
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    const txDate = String(vals['Date'] ?? '').slice(0, 10);
    // Only include transactions in the requested date range
    if (txDate < dateFrom || txDate > dateTo) continue;
    transactions.push({
      date: txDate,
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      description: String(vals['Notes'] ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      category: String(vals['Category'] ?? 'Other'),
    });
  }

  const result = reconcileTransactions(rules, transactions, dateFrom, dateTo);

  return NextResponse.json({ dateFrom, dateTo, result });
}