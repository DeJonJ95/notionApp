import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { occurrencesBetween, type RuleFrequency } from '@/lib/budgetDb';

const MONTHLY_FACTOR: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 24 / 12,
  monthly: 1,
};

// Projected income/expense for an arbitrary date range, computed from the
// user's active recurring rules using the same occurrence math the engine
// uses — so the Budget Summary's projection matches what will actually be
// generated.  When a rule's anchor falls after the query range, falls back
// to monthly-normalized estimates so past months show expected numbers.
export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const startStr = req.nextUrl.searchParams.get('start');
  const endStr = req.nextUrl.searchParams.get('end');
  if (!startStr || !endStr) {
    return NextResponse.json({ error: 'start and end required' }, { status: 400 });
  }
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T23:59:59');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: 'invalid dates' }, { status: 400 });
  }

  // Number of months covered by the range (for fallback estimation)
  const rangeMonths = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));

  let rules: { type: string; name: string; category: string; amount: number; frequency: string; anchorDate: Date }[] = [];
  try {
    rules = await prisma.recurringRule.findMany({
      where: { userId, isActive: true },
      select: { type: true, name: true, category: true, amount: true, frequency: true, anchorDate: true },
    });
  } catch {
    // RecurringRule table not migrated yet — just return zeros.
    return NextResponse.json({ income: 0, expense: 0, items: [], byCategory: {} });
  }

  let income = 0;
  let expense = 0;
  const byCategory: Record<string, number> = {};
  const items: { name: string; date: string; amount: number; type: string; category: string }[] = [];

  for (const r of rules) {
    const occ = occurrencesBetween(r.anchorDate, r.frequency as RuleFrequency, start, end);
    if (occ.length > 0) {
      for (const d of occ) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const signed = r.type === 'income' ? r.amount : -r.amount;
        if (r.type === 'income') {
          income += r.amount;
          byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
        } else {
          expense += r.amount;
        }
        items.push({ name: r.name, date: iso, amount: signed, type: r.type, category: r.category });
      }
    } else {
      // Anchor is after the range (or before but no occurrences landed).
      // Fall back to monthly-normalized estimate so past months aren't blank.
      const factor = MONTHLY_FACTOR[r.frequency] ?? 1;
      const monthly = r.amount * factor * rangeMonths;
      if (r.type === 'income') {
        income += monthly;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + monthly;
      } else {
        expense += monthly;
      }
      // Add a single summary item instead of individual dates
      items.push({
        name: `~ ${r.name} (estimated)`,
        date: startStr,
        amount: r.type === 'income' ? monthly : -monthly,
        type: r.type,
        category: r.category,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ income, expense, items, byCategory });
}
