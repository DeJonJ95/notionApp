import {
  normalizeBudgetToMonthly,
  denormalizeMonthlyBudget,
  monthElapsedPercent,
  computeCategoryBudgets,
} from '../lib/budgetDb';

describe('normalizeBudgetToMonthly', () => {
  it('converts weekly to monthly at 52/12', () => {
    expect(normalizeBudgetToMonthly(100, 'Weekly')).toBeCloseTo((100 * 52) / 12, 6);
  });

  it('converts bi-weekly to monthly at 26/12', () => {
    expect(normalizeBudgetToMonthly(100, 'Bi-Weekly')).toBeCloseTo((100 * 26) / 12, 6);
    expect(normalizeBudgetToMonthly(100, 'Biweekly')).toBeCloseTo((100 * 26) / 12, 6);
  });

  it('passes monthly through unchanged', () => {
    expect(normalizeBudgetToMonthly(250, 'Monthly')).toBe(250);
  });

  it('spreads quarterly and annual amounts across months', () => {
    expect(normalizeBudgetToMonthly(300, 'Quarterly')).toBe(100);
    expect(normalizeBudgetToMonthly(1200, 'Annual')).toBe(100);
  });

  it('passes blank, one-time, and unknown periods through unchanged', () => {
    expect(normalizeBudgetToMonthly(80, '')).toBe(80);
    expect(normalizeBudgetToMonthly(80, 'One-Time')).toBe(80);
    expect(normalizeBudgetToMonthly(80, 'Fortnightly')).toBe(80);
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeBudgetToMonthly(300, ' Quarterly ')).toBe(100);
  });
});

describe('denormalizeMonthlyBudget', () => {
  it('round-trips every known period', () => {
    for (const period of ['Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Annual']) {
      const stored = denormalizeMonthlyBudget(400, period);
      expect(normalizeBudgetToMonthly(stored, period)).toBeCloseTo(400, 6);
    }
  });

  it('passes unknown periods through unchanged', () => {
    expect(denormalizeMonthlyBudget(400, '')).toBe(400);
  });
});

describe('monthElapsedPercent', () => {
  const start = new Date(2026, 7, 1);   // Aug 1 2026
  const end = new Date(2026, 8, 1);     // Sep 1 2026 (exclusive)

  it('returns 0 for a month that has not started', () => {
    expect(monthElapsedPercent(start, end, new Date(2026, 6, 15))).toBe(0);
  });

  it('returns 100 for a month already over', () => {
    expect(monthElapsedPercent(start, end, new Date(2026, 9, 1))).toBe(100);
  });

  it('returns roughly half at mid-month', () => {
    const pct = monthElapsedPercent(start, end, new Date(2026, 7, 16, 12));
    expect(pct).toBeGreaterThan(48);
    expect(pct).toBeLessThan(52);
  });

  it('treats an empty window as fully elapsed', () => {
    expect(monthElapsedPercent(start, start, new Date(2026, 7, 10))).toBe(100);
  });
});

describe('computeCategoryBudgets', () => {
  it('joins budgets to spend and computes remaining + pctSpent', () => {
    const rows = computeCategoryBudgets(
      [{ category: 'Food & Dining', monthlyAmount: 400 }],
      [{ category: 'Food & Dining', spent: 300 }],
      50,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'Food & Dining',
      budgeted: 400,
      spent: 300,
      remaining: 100,
      pctSpent: 75,
      pctOfMonthElapsed: 50,
    });
  });

  it('reports overspend as negative remaining and pctSpent over 100', () => {
    const [row] = computeCategoryBudgets(
      [{ category: 'Shopping', monthlyAmount: 100 }],
      [{ category: 'Shopping', spent: 150 }],
      40,
    );
    expect(row.remaining).toBe(-50);
    expect(row.pctSpent).toBe(150);
  });

  it('includes budgeted categories with no spend', () => {
    const [row] = computeCategoryBudgets(
      [{ category: 'Healthcare', monthlyAmount: 75 }],
      [],
      10,
    );
    expect(row).toMatchObject({ budgeted: 75, spent: 0, remaining: 75, pctSpent: 0 });
  });

  it('includes spent categories with no budget and reports pctSpent 0', () => {
    const [row] = computeCategoryBudgets(
      [],
      [{ category: 'Entertainment', spent: 60 }],
      10,
    );
    expect(row).toMatchObject({ category: 'Entertainment', budgeted: 0, spent: 60, remaining: -60, pctSpent: 0 });
  });

  it('sums multiple envelope rows for the same category', () => {
    const [row] = computeCategoryBudgets(
      [
        { category: 'Utilities', monthlyAmount: 80 },
        { category: 'Utilities', monthlyAmount: 45 },
      ],
      [{ category: 'Utilities', spent: 100 }],
      50,
    );
    expect(row.budgeted).toBe(125);
    expect(row.remaining).toBe(25);
  });

  it('drops categories with neither budget nor spend', () => {
    const rows = computeCategoryBudgets(
      [{ category: 'Gifts & Donations', monthlyAmount: 0 }],
      [{ category: 'Gifts & Donations', spent: 0 }],
      50,
    );
    expect(rows).toHaveLength(0);
  });

  it('ignores blank category names', () => {
    const rows = computeCategoryBudgets(
      [{ category: '   ', monthlyAmount: 50 }],
      [{ category: '', spent: 20 }],
      50,
    );
    expect(rows).toHaveLength(0);
  });

  it('sorts budgeted categories first, most-used envelope first', () => {
    const rows = computeCategoryBudgets(
      [
        { category: 'Housing', monthlyAmount: 1000 },
        { category: 'Food & Dining', monthlyAmount: 400 },
      ],
      [
        { category: 'Housing', spent: 500 },        // 50%
        { category: 'Food & Dining', spent: 380 },  // 95%
        { category: 'Shopping', spent: 900 },       // unbudgeted
      ],
      50,
    );
    expect(rows.map((r) => r.category)).toEqual(['Food & Dining', 'Housing', 'Shopping']);
  });
});
