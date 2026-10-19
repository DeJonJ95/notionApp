import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  findOrCreateBudgetDb,
  detectRecurringPatterns,
  TRANSFERS_CATEGORY,
} from '@/lib/budgetDb';
import {
  findFeeWaste,
  findPriceCreep,
  findSubscriptionWaste,
  findCategoryDrift,
  type WasteFinding,
  type WasteTx,
} from '@/lib/budgetWaste';
import { loadLedger } from '@/lib/budgetLedger';

export type WastePayload = {
  findings: WasteFinding[];
  totalAnnualImpact: number;
  monthsAnalyzed: number;
  transactionsAnalyzed: number;
};

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = await findOrCreateBudgetDb(userId);
    // Moving money between your own accounts isn't spending, so it can't be
    // waste, and it would badly distort the category-drift medians.
    const { all } = await loadLedger(db.id);
    const txs: WasteTx[] = all
      .filter((t) => !t.planned && t.category !== TRANSFERS_CATEGORY)
      .map((t) => ({ date: t.date, vendor: t.vendor, amount: t.amount, category: t.category, notes: t.notes ?? undefined }));

    const dated = txs.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date));
    const months = new Set(dated.map((t) => t.date.slice(0, 7)));
    const monthsAnalyzed = months.size;
    const now = new Date();

    // Reuse the pattern detector for subscriptions rather than writing a second
    // one. Pre-filter to expenses (INDEX gotcha 24 heritage) and keep only the
    // confident, small-ish recurring charges people forget about.
    const expenses = dated.filter((t) => t.amount < 0);
    let subscriptions: {
      vendor: string;
      averageAmount: number;
      frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
      occurrences: number;
    }[] = [];
    try {
      subscriptions = detectRecurringPatterns(expenses, [])
        .filter((p) => p.confidence >= 0.6 && p.averageAmount <= 200)
        .map((p) => ({
          vendor: p.vendor,
          averageAmount: p.averageAmount,
          frequency: p.frequency,
          occurrences: p.occurrences,
        }));
    } catch (e) {
      console.warn('[budget-waste] subscription detection skipped:', (e as Error).message);
    }

    const findings: WasteFinding[] = [
      ...findFeeWaste(dated, monthsAnalyzed),
      ...findPriceCreep(dated),
      ...findCategoryDrift(dated, now),
      ...findSubscriptionWaste(subscriptions, dated),
    ].sort((a, b) => b.annualImpact - a.annualImpact);

    const payload: WastePayload = {
      findings,
      // Subscriptions are a cost you may well want to keep, so they are listed
      // but deliberately excluded from the headline "recoverable" figure —
      // padding it with every subscription would make it meaningless.
      totalAnnualImpact:
        Math.round(
          findings
            .filter((f) => f.kind !== 'subscription')
            .reduce((s, f) => s + f.annualImpact, 0) * 100,
        ) / 100,
      monthsAnalyzed,
      transactionsAnalyzed: dated.length,
    };
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
