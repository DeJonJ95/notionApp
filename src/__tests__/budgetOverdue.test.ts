import { computeExpectedVsActual, computeOverdueBills, type Coverage, type RuleLike } from '../lib/budgetExpected';

const today = new Date(2026, 8, 17);
const longAgo = new Date(2025, 0, 1);

// An older rule: the retired engine moved its anchor on, so its creation date bounds it.
const verizon: RuleLike = {
  id: 'r1', name: 'Verizon', type: 'expense', amount: 166.74, category: 'Utilities',
  frequency: 'monthly', anchorDate: new Date(2026, 9, 1), createdAt: longAgo, lastGeneratedDate: new Date(2026, 8, 1),
};

const charge = (date: string, vendor = 'Verizon', amount = -166.74, account: string | null = null) => ({ date, vendor, amount, account });
const statement = (from: string, to: string, account: string | null = null): Coverage => ({ account, from, to });
const september = statement('2026-09-01', '2026-09-30');

describe('computeOverdueBills', () => {
  it('calls a missed bill overdue once a statement covering its due date shows no payment', () => {
    const bills = computeOverdueBills([verizon], [charge('2026-08-01')], today, [statement('2026-08-05', '2026-09-04')]);
    expect(bills).toEqual([
      { ruleId: 'r1', name: 'Verizon', category: 'Utilities', amount: 166.74, dueDate: '2026-09-01', daysOverdue: 16, state: 'overdue' },
    ]);
  });

  it('calls it unconfirmed, never paid, while no statement reaches the due date', () => {
    const bills = computeOverdueBills([verizon], [charge('2026-08-01')], today, [statement('2026-07-05', '2026-08-04')]);
    expect(bills.map((b) => [b.dueDate, b.state])).toEqual([['2026-09-01', 'unconfirmed']]);
  });

  it('only lets a statement for the bill\'s own account call it overdue', () => {
    const paidFromChecking = [charge('2026-08-01', 'Verizon', -166.74, 'Checking 1234')];
    const card = statement('2026-08-20', '2026-09-19', 'Freedom Unlimited');
    expect(computeOverdueBills([verizon], paidFromChecking, today, [card])[0].state).toBe('unconfirmed');
    const checking = statement('2026-08-20', '2026-09-19', 'Checking 1234');
    expect(computeOverdueBills([verizon], paidFromChecking, today, [checking])[0].state).toBe('overdue');
  });

  it('clears the bill when a payment posts near or after the due date', () => {
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), charge('2026-09-02')], today, [september])).toEqual([]);
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), charge('2026-09-15', 'Verizon', -171.02)], today)).toEqual([]);
  });

  it('never treats a Planned row as a payment', () => {
    const planned = { ...charge('2026-09-01'), planned: true };
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), planned], today, [september])[0].state).toBe('overdue');
  });

  it('does not let a charge under half the bill, like a late fee, pay it', () => {
    const fee = charge('2026-09-06', 'Verizon Late Fee', -15);
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), fee], today, [september]).map((b) => b.state)).toEqual(['overdue']);
    const half = charge('2026-09-06', 'Verizon', -83.37);
    expect(computeOverdueBills([verizon], [charge('2026-08-01'), half], today)).toEqual([]);
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

  it('starts a new rule at its own first due date', () => {
    const storage: RuleLike = { ...verizon, id: 'ns', name: 'National Storage', amount: 120, anchorDate: new Date(2026, 8, 1), createdAt: today, lastGeneratedDate: null };
    expect(computeOverdueBills([storage], [], new Date(2026, 9, 19)).map((b) => b.dueDate)).toEqual(['2026-09-01', '2026-10-01']);
    const later: RuleLike = { ...storage, anchorDate: new Date(2026, 9, 1) };
    expect(computeOverdueBills([later], [], new Date(2026, 9, 19)).map((b) => b.dueDate)).toEqual(['2026-10-01']);
  });
});

describe('computeExpectedVsActual', () => {
  const sep = { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1), now: today };

  it('matches a payment near its due date and counts only bill payments as paid', () => {
    const txs = [charge('2026-09-02', 'Verizon', -170), charge('2026-09-05', 'Kroger', -80)];
    const result = computeExpectedVsActual([verizon], txs, sep);
    expect(result.expenseExpected).toBe(166.74);
    expect(result.expenseActual).toBe(170);
    expect(result.rules).toEqual([
      {
        ruleId: 'r1', name: 'Verizon', type: 'expense', expectedAmt: 166.74, expectedCount: 1, matchedCount: 1, unconfirmedCount: 0, matchedTotal: 170,
        dueDates: [{ due: '2026-09-01', state: 'paid', payment: { date: '2026-09-02', vendor: 'Verizon', amount: 170 } }],
      },
    ]);
  });

  it('agrees with the overdue check about a payment that posted a week late', () => {
    const txs = [charge('2026-08-01'), charge('2026-09-09', 'Verizon', -166.74)];
    expect(computeExpectedVsActual([verizon], txs, sep).rules[0]).toMatchObject({ matchedCount: 1, matchedTotal: 166.74 });
    expect(computeOverdueBills([verizon], txs, today)).toEqual([]);
  });

  it('counts every weekly due date in the month even after the engine moved the anchor on', () => {
    const gym: RuleLike = { ...verizon, id: 'g', name: 'Gym', amount: 10, frequency: 'weekly', anchorDate: new Date(2026, 9, 20) };
    const result = computeExpectedVsActual([gym], [], { ...sep, now: new Date(2026, 9, 19) });
    expect(result.rules[0].expectedCount).toBe(5); // Sep 1, 8, 15, 22, 29
  });

  it('does not count next month\'s first due date in a past month', () => {
    const rent: RuleLike = { ...verizon, id: 'rent', name: 'Rent', amount: 900, anchorDate: new Date(2026, 9, 1) };
    const result = computeExpectedVsActual([rent], [], { ...sep, now: new Date(2026, 9, 19) });
    expect(result.rules[0].expectedCount).toBe(1);
  });

  it('lists each due date with what settled it, or why nothing did', () => {
    const gym: RuleLike = { ...verizon, id: 'g', name: 'Gym', amount: 10, frequency: 'weekly', anchorDate: new Date(2026, 8, 22) };
    const txs = [charge('2026-09-01', 'Gym', -10)];
    const result = computeExpectedVsActual([gym], txs, { ...sep, now: new Date(2026, 8, 16) }, [statement('2026-09-01', '2026-09-10')]);
    expect(result.rules[0].dueDates.map((d) => [d.due, d.state, d.payment?.amount ?? null])).toEqual([
      ['2026-09-01', 'paid', 10], ['2026-09-08', 'overdue', null], ['2026-09-15', 'unconfirmed', null],
    ]);
  });

  it('does not let other spending make a missed bill look paid', () => {
    const storage: RuleLike = { ...verizon, id: 'ns', name: 'Test Storage Two', amount: 120, anchorDate: new Date(2026, 9, 1), lastGeneratedDate: null };
    const txs = [charge('2026-10-03', 'Kroger', -54.2), charge('2026-10-07', 'Shell', -40.3)];
    const oct = { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1), now: new Date(2026, 9, 19) };
    const result = computeExpectedVsActual([storage], txs, oct, [statement('2026-09-15', '2026-10-14')]);
    expect([result.expenseExpected, result.expenseActual]).toEqual([120, 0]);
  });

  it('counts a paycheck received for less than the rule as what came in', () => {
    const pay: RuleLike = { ...verizon, id: 'pay', name: 'City of Detroit Payroll', type: 'income', amount: 2000 };
    const txs = [charge('2026-09-02', 'CITY OF DETROIT PAYROLL', 1990), charge('2026-09-10', 'Venmo from Sam', 300)];
    const result = computeExpectedVsActual([pay], txs, sep);
    expect([result.incomeExpected, result.incomeActual]).toEqual([2000, 1990]);
  });

  it('counts an unpaid due date no statement reaches as unconfirmed, and a Planned row as nothing paid', () => {
    const txs = [{ ...charge('2026-09-01'), planned: true }, charge('2026-09-05', 'Kroger', -80)];
    const result = computeExpectedVsActual([verizon], txs, sep);
    expect(result.expenseActual).toBe(0);
    expect(result.rules[0]).toMatchObject({ matchedCount: 0, unconfirmedCount: 1, matchedTotal: 0 });
    expect(computeExpectedVsActual([verizon], txs, sep, [september]).rules[0].unconfirmedCount).toBe(0);
  });
});
