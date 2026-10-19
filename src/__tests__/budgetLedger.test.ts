import { isForecastRow, readLedger } from '../lib/budgetLedger';
import { detectRepeatVendors } from '../lib/budgetRepeatVendors';

const page = (id: string, vals: Record<string, unknown>, title = 'Untitled') => ({
  id,
  title,
  properties: Object.entries(vals).map(([name, value]) => ({ value, property: { name } })),
});

describe('isForecastRow', () => {
  it('knows the engine marker and the Planned status', () => {
    expect(isForecastRow({ Notes: 'Recurring expense: National Storage' })).toBe(true);
    expect(isForecastRow({ Status: 'Planned' })).toBe(true);
    expect(isForecastRow({ Status: 'Cleared', Notes: 'paid at the desk' })).toBe(false);
    expect(isForecastRow({ Notes: 'CITY OF DETROIT PAYROLL 26062310' })).toBe(false);
    expect(isForecastRow({ Notes: 'Recurring donation to the food bank' })).toBe(false);
  });
});

describe('readLedger', () => {
  it('flags forecasts, signs amounts, and splits out envelopes and savings', () => {
    const { all, monthlyBudgets, savingsRows } = readLedger([
      page('p1', { Type: 'Expense', Amount: 120, Date: '2026-10-01T00:00:00', Vendor: 'National Storage', Status: 'Planned', Notes: 'Recurring expense: National Storage' }),
      page('p2', { Type: 'Income', Amount: -3746, Date: '2026-10-03', Vendor: 'City of Detroit', Account: 'Checking 1234' }),
      page('p3', { Type: 'Budget', Category: 'Food & Dining', 'Budgeted Amount': 400, 'Budget Period': 'Monthly' }),
      page('p4', { Type: 'Savings', Amount: 50, Date: '2026-10-04', Notes: 'Emergency fund' }, 'Transfer'),
      page('p5', { Type: 'Expense', Amount: 0, Date: '2026-10-05' }),
    ]);
    expect(all.map((t) => [t.pageId, t.date, t.vendor, t.amount, t.account, t.planned])).toEqual([
      ['p1', '2026-10-01', 'National Storage', -120, null, true],
      ['p2', '2026-10-03', 'City of Detroit', 3746, 'Checking 1234', false],
      ['p4', '2026-10-04', 'Transfer', -50, null, false],
    ]);
    expect(Object.fromEntries(monthlyBudgets)).toEqual({ 'Food & Dining': 400 });
    expect(savingsRows).toEqual([{ text: 'Transfer Emergency fund', amount: 50 }]);
  });
});

describe('detectRepeatVendors', () => {
  const tx = (vendor: string, date: string, amount: number, category = 'Subscriptions') =>
    ({ pageId: `${vendor}-${date}`, vendor, date, amount, category, type: 'Expense', account: null, notes: null, planned: false });

  it('separates steady charges from other repeat vendors and skips old or one-off ones', () => {
    const now = new Date(2026, 9, 19);
    const { subscriptions, repeatVendors } = detectRepeatVendors([
      tx('Netflix', '2026-09-10', -15.49), tx('Netflix', '2026-10-10', -15.49),
      tx('Kroger', '2026-09-12', -80, 'Food & Dining'), tx('Kroger', '2026-10-01', -82, 'Food & Dining'),
      tx('DTE', '2026-09-20', -60, 'Utilities'), tx('DTE', '2026-10-20', -140, 'Utilities'),
      tx('Gym', '2026-01-05', -30), tx('Gym', '2026-10-05', -30),
      tx('Payroll', '2026-10-01', 3000),
    ], now);
    expect(subscriptions.map((s) => [s.vendor, s.monthlyEstimate, s.occurrences])).toEqual([['Netflix', 15.49, 2]]);
    expect(repeatVendors.map((r) => [r.vendor, r.totalAmount, r.averageAmount])).toEqual([['DTE', 200, 100], ['Kroger', 162, 81]]);
  });
});
