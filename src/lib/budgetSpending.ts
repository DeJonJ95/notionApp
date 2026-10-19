import type { Tx } from '@/lib/budgetLedger';

export type CategorySpend = { category: string; spent: number; pct: number };
export type CategoryExcess = { category: string; spent: number; vsPrior: number; pctChange: number };
export type MonthTrend = { month: string; income: number; expenses: number };

const inRange = (s: string, lo: Date, hi: Date) => {
  const d = new Date(s + 'T00:00:00');
  return d >= lo && d < hi;
};

function spentByCategory(rows: Tx[]): Map<string, number> {
  const spent = new Map<string, number>();
  for (const t of rows) {
    if (t.amount >= 0) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  return spent;
}

/** This month's spend per category, plus the categories that grew more than 50%
 *  (and past $20) against the month before. */
export function categorySpending(
  thisMonth: Tx[],
  prevMonth: Tx[],
  expenses: number,
): { byCategory: CategorySpend[]; excesses: CategoryExcess[] } {
  const byCategory = Array.from(spentByCategory(thisMonth), ([category, spent]) => ({
    category,
    spent,
    pct: expenses > 0 ? (spent / expenses) * 100 : 0,
  })).sort((a, b) => b.spent - a.spent);

  const prior = spentByCategory(prevMonth);
  const excesses = byCategory
    .map((c) => {
      const before = prior.get(c.category) ?? 0;
      const pctChange = before > 0 ? ((c.spent - before) / before) * 100 : (c.spent > 0 ? 999 : 0);
      return { category: c.category, spent: c.spent, vsPrior: c.spent - before, pctChange };
    })
    .filter((e) => e.pctChange > 50 && e.spent > 20)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, 5);
  return { byCategory, excesses };
}

/** Income and expenses for each of the last six calendar months, oldest first. */
export function monthlyTrends(rows: Tx[], now: Date): MonthTrend[] {
  const trends: MonthTrend[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    let income = 0;
    let expenses = 0;
    for (const t of rows) {
      if (!inRange(t.date, start, end)) continue;
      if (t.amount > 0) income += t.amount;
      else expenses += Math.abs(t.amount);
    }
    trends.push({
      month: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      income: Math.round(income),
      expenses: Math.round(expenses),
    });
  }
  return trends;
}
