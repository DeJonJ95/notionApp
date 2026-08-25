import { forecastMonths, estimateVariableMonthlySpend } from '../lib/budgetDb';

const NOW = new Date(2026, 7, 25); // Aug 25 2026, 7 days left in a 31-day month
const occ = (date: string, amount: number) => ({ date, amount });

describe('forecastMonths', () => {
  it('chains the ending balance month over month', () => {
    const out = forecastMonths(
      [occ('2026-09-01', 2000), occ('2026-09-15', -500), occ('2026-10-01', 2000)],
      { startingBalance: 1000, months: 3, today: NOW, monthlyVariableSpend: 0 },
    );
    expect(out).toHaveLength(3);
    expect(out[0].endingBalance).toBe(1000);            // nothing left in August
    expect(out[1].net).toBe(1500);                      // September
    expect(out[1].endingBalance).toBe(2500);
    expect(out[2].endingBalance).toBe(4500);            // October
  });

  it('labels and dates the months correctly', () => {
    const out = forecastMonths([], { startingBalance: 0, months: 3, today: NOW, monthlyVariableSpend: 0 });
    expect(out.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(out[1].label).toBe('September 2026');
  });

  it('rolls into the next year', () => {
    const out = forecastMonths([], {
      startingBalance: 0, months: 3, today: new Date(2026, 11, 10), monthlyVariableSpend: 0,
    });
    expect(out.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('counts only the remainder of the current month', () => {
    const out = forecastMonths(
      // The 5th already happened; the 28th has not.
      [occ('2026-08-05', 3000), occ('2026-08-28', -100)],
      { startingBalance: 0, months: 1, today: NOW, monthlyVariableSpend: 0 },
    );
    expect(out[0].isPartial).toBe(true);
    expect(out[0].income).toBe(0);
    expect(out[0].recurringExpenses).toBe(100);
  });

  it('prorates the variable estimate across the days left in a partial month', () => {
    const out = forecastMonths([], {
      startingBalance: 0, months: 2, today: NOW, monthlyVariableSpend: 310,
    });
    // Aug 25..31 is 7 of 31 days → 310 * 7/31 = 70
    expect(out[0].variableExpenses).toBe(70);
    // A whole month gets the whole estimate.
    expect(out[1].variableExpenses).toBe(310);
  });

  it('counts variable spending as an expense in the net', () => {
    const out = forecastMonths([occ('2026-09-01', 1000)], {
      startingBalance: 0, months: 2, today: NOW, monthlyVariableSpend: 600,
    });
    expect(out[1].income).toBe(1000);
    expect(out[1].expenses).toBe(600);
    expect(out[1].net).toBe(400);
  });

  it('separates recurring bills from the variable estimate', () => {
    const out = forecastMonths([occ('2026-09-10', -250)], {
      startingBalance: 0, months: 2, today: NOW, monthlyVariableSpend: 400,
    });
    expect(out[1].recurringExpenses).toBe(250);
    expect(out[1].variableExpenses).toBe(400);
    expect(out[1].expenses).toBe(650);
  });

  it('shows the balance going negative when outgoings exceed income', () => {
    const out = forecastMonths([occ('2026-09-01', 100), occ('2026-10-01', 100)], {
      startingBalance: 500, months: 3, today: NOW, monthlyVariableSpend: 800,
    });
    expect(out.some((m) => m.endingBalance < 0)).toBe(true);
  });

  it('ignores occurrences beyond the horizon and bad dates', () => {
    const out = forecastMonths([occ('2027-06-01', 9999), occ('nonsense', 5000)], {
      startingBalance: 0, months: 2, today: NOW, monthlyVariableSpend: 0,
    });
    expect(out.every((m) => m.income === 0)).toBe(true);
  });

  it('returns nothing for a zero-month horizon', () => {
    expect(forecastMonths([], { startingBalance: 0, months: 0, today: NOW, monthlyVariableSpend: 0 })).toHaveLength(0);
  });
});

describe('estimateVariableMonthlySpend', () => {
  const tx = (date: string, vendor: string, amount: number) => ({ date, vendor, amount });

  it('averages non-recurring spend over the complete months that have data', () => {
    const out = estimateVariableMonthlySpend(
      [tx('2026-07-05', 'Kroger', -100), tx('2026-06-05', 'Kroger', -200)],
      [],
      NOW,
    );
    expect(out).toBe(150);
  });

  it('excludes spending a recurring rule already covers, so bills are not double-counted', () => {
    const out = estimateVariableMonthlySpend(
      [tx('2026-07-05', 'Kroger', -100), tx('2026-07-10', 'Netflix', -15.99)],
      [{ name: 'Netflix', amount: 15.99 }],
      NOW,
    );
    expect(out).toBe(100);
  });

  it('still counts a rule-named vendor whose amount is far off the rule', () => {
    const out = estimateVariableMonthlySpend(
      [tx('2026-07-05', 'Netflix', -200)],
      [{ name: 'Netflix', amount: 15.99 }],
      NOW,
    );
    expect(out).toBe(200);
  });

  it('ignores income and the current, incomplete month', () => {
    const out = estimateVariableMonthlySpend(
      [tx('2026-07-05', 'Kroger', -100), tx('2026-07-06', 'Payroll', 5000), tx('2026-08-20', 'Kroger', -900)],
      [],
      NOW,
    );
    expect(out).toBe(100);
  });

  it('divides by months with data, not the lookback length', () => {
    // Only one of the three lookback months has anything.
    expect(estimateVariableMonthlySpend([tx('2026-07-05', 'Kroger', -300)], [], NOW)).toBe(300);
  });

  it('returns 0 with no history', () => {
    expect(estimateVariableMonthlySpend([], [], NOW)).toBe(0);
  });
});
