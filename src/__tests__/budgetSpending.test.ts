import { categorySpending, monthlyTrends } from '../lib/budgetSpending';

const tx = (date: string, amount: number, category = 'Food & Dining') =>
  ({ pageId: date + amount, vendor: 'v', date, amount, category, type: amount > 0 ? 'Income' : 'Expense', account: null, planned: false });

describe('categorySpending', () => {
  it('ranks categories by spend and flags big jumps over last month', () => {
    const now = [tx('2026-10-02', -300), tx('2026-10-03', -100, 'Utilities'), tx('2026-10-04', 500, 'Other'), tx('2026-10-05', -15, 'Gifts')];
    const prev = [tx('2026-09-02', -100), tx('2026-09-03', -95, 'Utilities')];
    const { byCategory, excesses } = categorySpending(now, prev, 415);
    expect(byCategory.map((c) => [c.category, c.spent, Math.round(c.pct)])).toEqual([
      ['Food & Dining', 300, 72], ['Utilities', 100, 24], ['Gifts', 15, 4],
    ]);
    expect(excesses).toEqual([{ category: 'Food & Dining', spent: 300, vsPrior: 200, pctChange: 200 }]);
  });
});

describe('monthlyTrends', () => {
  it('totals the last six months, oldest first, rounded to dollars', () => {
    const trends = monthlyTrends([tx('2026-10-01', 1000.4), tx('2026-10-09', -20.6), tx('2026-05-31', -50), tx('2026-04-30', -999)], new Date(2026, 9, 19));
    expect(trends.map((t) => t.month)).toEqual(['May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26']);
    expect(trends[0]).toMatchObject({ income: 0, expenses: 50 });
    expect(trends[5]).toMatchObject({ income: 1000, expenses: 21 });
  });
});
