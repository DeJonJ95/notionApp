import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findOrCreateBudgetDb, detectRecurringPatterns } from '@/lib/budgetDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Normalize a cadence to a per-month multiplier so subscriptions of
// different frequencies can be ranked by true annual cost.
const PER_MONTH: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
};

type Tx = { date: string; vendor: string; amount: number; category: string };

export type SubscriptionRow = {
  vendor: string;
  category: string;
  frequency: string;
  occurrences: number;
  confidence: number;
  avgAmount: number;
  monthlyEstimate: number;
  annualCost: number;
  minAmount: number;
  maxAmount: number;
  firstAmount: number;
  latestAmount: number;
  priceChangePercent: number; // latest vs first charge
  lastDate: string;
};

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await findOrCreateBudgetDb(userId);

  const pages = await prisma.page.findMany({
    where: { databaseId: db.id, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  // Flatten transaction pages into expenses only (recurring income isn't a
  // subscription). Amount is stored positive; Type distinguishes direction.
  const expenses: Tx[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget' || type === 'Income') continue;
    const amt = Math.abs(Number(vals['Amount'] ?? 0));
    if (!amt) continue;
    expenses.push({
      date: String(vals['Date'] ?? '').slice(0, 10),
      vendor: String(vals['Vendor'] ?? p.title ?? '').trim(),
      amount: amt,
      category: String(vals['Category'] ?? 'Other'),
    });
  }

  // Pass an empty existing-rules list so every recurring vendor surfaces,
  // whether or not it already has a budget rule.
  const patterns = detectRecurringPatterns(
    expenses.map((t) => ({ vendor: t.vendor, amount: t.amount, date: t.date, category: t.category })),
    []
  );

  // Group actual charges by vendor for price-drift / last-charge lookups.
  const byVendor = new Map<string, Tx[]>();
  for (const t of expenses) {
    const key = t.vendor.toLowerCase();
    const arr = byVendor.get(key) ?? [];
    arr.push(t);
    byVendor.set(key, arr);
  }

  // Every pattern here came from the expenses-only input above, so each is a
  // subscription by construction — the helper's own `type` field is derived
  // from abs() amounts and can't distinguish direction, so we don't use it.
  const subscriptions: SubscriptionRow[] = patterns
    .map((p) => {
      const charges = (byVendor.get(p.vendor.toLowerCase()) ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
      const amounts = charges.map((c) => c.amount);
      const firstAmount = amounts[0] ?? p.averageAmount;
      const latestAmount = amounts[amounts.length - 1] ?? p.averageAmount;
      const minAmount = amounts.length ? Math.min(...amounts) : p.averageAmount;
      const maxAmount = amounts.length ? Math.max(...amounts) : p.averageAmount;
      const priceChangePercent =
        firstAmount > 0 ? Math.round(((latestAmount - firstAmount) / firstAmount) * 1000) / 10 : 0;
      const monthlyEstimate = Math.round(p.averageAmount * (PER_MONTH[p.frequency] ?? 1) * 100) / 100;
      const lastDate = charges.length ? charges[charges.length - 1].date : '';

      return {
        vendor: p.vendor,
        category: p.category,
        frequency: p.frequency,
        occurrences: p.occurrences,
        confidence: p.confidence,
        avgAmount: p.averageAmount,
        monthlyEstimate,
        annualCost: Math.round(monthlyEstimate * 12 * 100) / 100,
        minAmount,
        maxAmount,
        firstAmount,
        latestAmount,
        priceChangePercent,
        lastDate,
      };
    })
    .sort((a, b) => b.annualCost - a.annualCost);

  const totalAnnual = Math.round(subscriptions.reduce((s, x) => s + x.annualCost, 0) * 100) / 100;
  const totalMonthly = Math.round(subscriptions.reduce((s, x) => s + x.monthlyEstimate, 0) * 100) / 100;

  return NextResponse.json({ subscriptions, totalAnnual, totalMonthly });
}
