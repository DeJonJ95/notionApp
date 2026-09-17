import { computeExpectedVsActual, computeOverdueBills, type RuleLike } from '../lib/budgetExpected';

const today = new Date(2026, 8, 17);
const longAgo = new Date(2025, 0, 1);

const verizon: RuleLike = {
  id: 'r1', name: 'Verizon', type: 'expense', amount: 166.74, category: 'Utilities',
  frequency: 'monthly', anchorDate: new Date(2026, 9, 1), createdAt: longAgo,
};

const charge = (date: string, vendor = 'Verizon', amount = -166.74) => ({ date, vendor, amount });

describe('computeOverdueBills', () => {
  it('flags a monthly bill whose due date passed with no ledger row', () => {
    const bills = computeOverdueBills([verizon], [charge('2026-08-01')], today);
    expect(bills).toEqual([
      { ruleId: 'r1', name: 'Verizon', category: 'Utilities', amount: 166.74, dueDate: '2026-09-01', daysOverdue: 16 },
    ]);
  });

  it('clears the bill when a payment posts near or after the due date', () => {
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), charge('2026-09-02')], today)).toEqual([]);
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), charge('2026-09-15', 'Verizon', -171.02)], today)).toEqual([]);
  });

  it('treats the engine placeholder as not yet known rather than overdue', () => {
    const planned = charge('2026-09-01');
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), planned], today)).toEqual([]);
  });

  it('does not let next month\'s early payment cover a missed one', () => {
    const bills = computeOverdueBills([verizon], [charge('2026-08-01'), charge('2026-09-28')], new Date(2026, 8, 30));
    expect(bills.map((b) => b.dueDate)).toEqual(['2026-09-01']);
  });

  it('walks a weekly anchor back so past occurrences are visible', () => {
    const gym: RuleLike = { ...verizon, id: 'r2', name: 'Gym', amount: 10, frequency: 'weekly', anchorDate: new Date(2026, 8, 20) };
    const bills = computeOverdueBills([gym], [], today);
    expect(bills.length).toBeGreaterThan(4);
    expect(bills.at(-1)?.dueDate).toBe('2026-09-13');
  });

  it('ignores income rules and occurrences before the rule existed', () => {
    const pay: RuleLike = { ...verizon, id: 'r3', name: 'Paycheck', type: 'income' };
    const fresh: RuleLike = { ...verizon, id: 'r4', createdAt: new Date(2026, 8, 10) };
    expect(computeOverdueBills([pay, fresh], [], today)).toEqual([]);
  });
});

describe('computeExpectedVsActual', () => {
  it('matches occurrences within 3 days and 30% of the rule amount', () => {
    const start = new Date(2026, 8, 1);
    const end = new Date(2026, 9, 1);
    const txs = [charge('2026-09-02', 'Verizon', -170), charge('2026-09-05', 'Kroger', -80)];
    const result = computeExpectedVsActual([verizon], txs, { start, end, now: today });
    expect(result.expenseExpected).toBe(166.74);
    expect(result.expenseActual).toBe(250);
    expect(result.rules).toEqual([
      { ruleId: 'r1', name: 'Verizon', type: 'expense', expectedAmt: 166.74, expectedCount: 1, matchedCount: 1, matchedTotal: 170 },
    ]);
  });
});
