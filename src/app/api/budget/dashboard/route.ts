import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findOrCreateBudgetDb } from '@/lib/budgetDb';

export type Tx = {
  pageId: string;
  date: string;
  vendor: string;
  amount: number;       // signed: negative = expense, positive = income
  category: string;
  type: string;
};

export type Subscription = {
  vendor: string;
  averageAmount: number;
  occurrences: number;
  lastDate: string;
  category: string;
  monthlyEstimate: number;
};

export type DashboardPayload = {
  databaseId: string;
  databaseName: string;
  monthLabel: string;
  income: number;
  expenses: number;
  net: number;
  prevMonth: { income: number; expenses: number; net: number };
  byCategory: { category: string; spent: number; pct: number }[];
  excesses: { category: string; spent: number; vsPrior: number; pctChange: number }[];
  subscriptions: Subscription[];
  recentTransactions: Tx[];
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await findOrCreateBudgetDb(userId);
  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  // Pull every transaction (joins property values keyed by name)
  const pages = await prisma.page.findMany({
    where: { databaseId: db.id, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  const all: Tx[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') continue; // not a transaction
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    all.push({
      pageId: p.id,
      date: String(vals['Date'] ?? '').slice(0, 10),
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      category: String(vals['Category'] ?? 'Other'),
      type,
    });
  }

  // Month windows
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const inRange = (s: string, lo: Date, hi: Date) => {
    const d = new Date(s + 'T00:00:00');
    return d >= lo && d < hi;
  };

  const thisM = all.filter((t) => inRange(t.date, thisMonthStart, nextMonthStart));
  const prevM = all.filter((t) => inRange(t.date, prevMonthStart, thisMonthStart));

  // If "this month" is empty (e.g. statements imported are older), use the
  // most recent month that actually has data so the dashboard isn't blank.
  let usedThis = thisM;
  let usedPrev = prevM;
  let monthLabel = thisMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (thisM.length === 0 && all.length > 0) {
    const latestDate = all
      .map((t) => t.date)
      .sort()
      .at(-1)!;
    const [y, m] = latestDate.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const prevStart = new Date(y, m - 2, 1);
    usedThis = all.filter((t) => inRange(t.date, start, end));
    usedPrev = all.filter((t) => inRange(t.date, prevStart, start));
    monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  const income = usedThis.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = usedThis.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const prevIncome = usedPrev.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const prevExpenses = usedPrev.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  // Spending by category (current period)
  const catMap = new Map<string, number>();
  for (const t of usedThis) {
    if (t.amount >= 0) continue;
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  const byCategory = Array.from(catMap.entries())
    .map(([category, spent]) => ({
      category,
      spent,
      pct: expenses > 0 ? (spent / expenses) * 100 : 0,
    }))
    .sort((a, b) => b.spent - a.spent);

  // "Excesses" — categories where spending grew >50% vs prior month
  const prevCat = new Map<string, number>();
  for (const t of usedPrev) {
    if (t.amount >= 0) continue;
    prevCat.set(t.category, (prevCat.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  const excesses = byCategory
    .map((c) => {
      const prior = prevCat.get(c.category) ?? 0;
      const delta = c.spent - prior;
      const pctChange = prior > 0 ? ((c.spent - prior) / prior) * 100 : (c.spent > 0 ? 999 : 0);
      return { category: c.category, spent: c.spent, vsPrior: delta, pctChange };
    })
    .filter((e) => e.pctChange > 50 && e.spent > 20)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, 5);

  // Subscription detection: vendor with 2+ expense charges over the trailing
  // 90 days with similar amount (within 15% of mean).
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recent = all.filter((t) => t.amount < 0 && new Date(t.date) >= cutoff);
  const byVendor = new Map<string, Tx[]>();
  for (const t of recent) {
    const key = t.vendor.trim();
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(t);
  }
  const subscriptions: Subscription[] = [];
  for (const [vendor, txs] of byVendor.entries()) {
    if (txs.length < 2) continue;
    const amounts = txs.map((t) => Math.abs(t.amount));
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const inRangeCount = amounts.filter((a) => Math.abs(a - mean) / mean < 0.15).length;
    if (inRangeCount < 2) continue;
    // Don't flag food/groceries/gas as subscriptions
    if (['Food & Dining', 'Transport'].includes(txs[0].category)) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    subscriptions.push({
      vendor,
      averageAmount: Math.round(mean * 100) / 100,
      occurrences: txs.length,
      lastDate: txs.at(-1)!.date,
      category: txs[0].category,
      monthlyEstimate: Math.round(mean * 100) / 100,
    });
  }
  subscriptions.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);

  const recentTransactions = all.slice(0, 25);

  const payload: DashboardPayload = {
    databaseId: db.id,
    databaseName: db.name,
    monthLabel,
    income,
    expenses,
    net: income - expenses,
    prevMonth: { income: prevIncome, expenses: prevExpenses, net: prevIncome - prevExpenses },
    byCategory,
    excesses,
    subscriptions,
    recentTransactions,
  };

  return NextResponse.json(payload);
}
