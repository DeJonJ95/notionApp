import {
  computeAccountBalancesFrom,
  buildBalanceCurve,
  UNASSIGNED_ACCOUNT,
} from '../lib/budgetDb';

const imp = (account: string | null, closingBalance: number | null, dateTo: string) => ({
  account,
  closingBalance,
  dateTo: new Date(dateTo + 'T00:00:00'),
});

describe('computeAccountBalancesFrom', () => {
  it('anchors on the closing balance and rolls forward later transactions', () => {
    const rows = computeAccountBalancesFrom(
      [imp('Checking 1234', 1000, '2026-07-31')],
      [
        { account: 'Checking 1234', date: '2026-07-15', amount: -50 },  // inside the statement
        { account: 'Checking 1234', date: '2026-08-02', amount: -200 }, // after it
        { account: 'Checking 1234', date: '2026-08-05', amount: 500 },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account: 'Checking 1234',
      statementBalance: 1000,
      sinceStatement: 300,
      balance: 1300,
      asOf: '2026-07-31',
      txCount: 3,
    });
  });

  it('ignores transactions dated on the statement end date itself', () => {
    const [row] = computeAccountBalancesFrom(
      [imp('Checking', 500, '2026-07-31')],
      [{ account: 'Checking', date: '2026-07-31', amount: -100 }],
    );
    expect(row.sinceStatement).toBe(0);
    expect(row.balance).toBe(500);
  });

  it('uses the most recent statement when an account has several', () => {
    const [row] = computeAccountBalancesFrom(
      [
        imp('Checking', 1000, '2026-06-30'),
        imp('Checking', 750, '2026-07-31'),
        imp('Checking', 900, '2026-05-31'),
      ],
      [{ account: 'Checking', date: '2026-08-01', amount: -50 }],
    );
    expect(row.asOf).toBe('2026-07-31');
    expect(row.statementBalance).toBe(750);
    expect(row.balance).toBe(700);
  });

  it('keeps accounts separate', () => {
    const rows = computeAccountBalancesFrom(
      [imp('Checking', 1000, '2026-07-31'), imp('Savings', 5000, '2026-07-31')],
      [
        { account: 'Checking', date: '2026-08-02', amount: -200 },
        { account: 'Savings', date: '2026-08-02', amount: 100 },
      ],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.account, r]));
    expect(byName['Checking'].balance).toBe(800);
    expect(byName['Savings'].balance).toBe(5100);
  });

  it('puts account-less transactions in the Unassigned bucket with no balance claim', () => {
    const rows = computeAccountBalancesFrom(
      [imp('Checking', 1000, '2026-07-31')],
      [
        { account: 'Checking', date: '2026-08-02', amount: -200 },
        { account: null, date: '2026-08-03', amount: -75 },
        { date: '2026-08-04', amount: -25 },
        { account: '   ', date: '2026-08-05', amount: -10 },
      ],
    );
    const unassigned = rows.find((r) => r.account === UNASSIGNED_ACCOUNT)!;
    expect(unassigned.balance).toBeNull();
    expect(unassigned.asOf).toBeNull();
    expect(unassigned.txCount).toBe(3);
    expect(rows[rows.length - 1].account).toBe(UNASSIGNED_ACCOUNT);
  });

  it('lists an account with transactions but no statement balance without guessing', () => {
    const [row] = computeAccountBalancesFrom(
      [imp('Checking', null, '2026-07-31')],
      [{ account: 'Checking', date: '2026-08-02', amount: -200 }],
    );
    expect(row.balance).toBeNull();
    expect(row.statementBalance).toBeNull();
    expect(row.sinceStatement).toBe(0);
    expect(row.txCount).toBe(1);
  });

  it('ignores import rows with no account name', () => {
    const rows = computeAccountBalancesFrom([imp(null, 1234, '2026-07-31')], []);
    expect(rows).toHaveLength(0);
  });

  it('reports an account that has a statement but no transactions yet', () => {
    const [row] = computeAccountBalancesFrom([imp('Checking', 1000, '2026-07-31')], []);
    expect(row).toMatchObject({ balance: 1000, sinceStatement: 0, txCount: 0 });
  });

  it('sorts balanced accounts first, largest first, Unassigned last', () => {
    const rows = computeAccountBalancesFrom(
      [imp('Checking', 100, '2026-07-31'), imp('Savings', 9000, '2026-07-31')],
      [
        { account: 'Credit Card', date: '2026-08-01', amount: -40 },
        { account: null, date: '2026-08-01', amount: -5 },
      ],
    );
    expect(rows.map((r) => r.account)).toEqual(['Savings', 'Checking', 'Credit Card', UNASSIGNED_ACCOUNT]);
  });
});

describe('buildBalanceCurve', () => {
  const today = new Date(2026, 7, 23); // Aug 23 2026

  it('returns one point per day including today', () => {
    const { curve } = buildBalanceCurve(1000, [], 5, today);
    expect(curve).toHaveLength(6);
    expect(curve[0].date).toBe('2026-08-23');
    expect(curve[5].date).toBe('2026-08-28');
    expect(curve.every((p) => p.balance === 1000)).toBe(true);
  });

  it('applies scheduled amounts on their day and carries them forward', () => {
    const { curve } = buildBalanceCurve(1000, [
      { date: '2026-08-25', amount: -300 },
      { date: '2026-08-27', amount: 500 },
    ], 5, today);
    expect(curve.find((p) => p.date === '2026-08-24')!.balance).toBe(1000);
    expect(curve.find((p) => p.date === '2026-08-25')!.balance).toBe(700);
    expect(curve.find((p) => p.date === '2026-08-26')!.balance).toBe(700);
    expect(curve.find((p) => p.date === '2026-08-27')!.balance).toBe(1200);
  });

  it('sums multiple occurrences landing on the same day', () => {
    const { curve } = buildBalanceCurve(500, [
      { date: '2026-08-24', amount: -100 },
      { date: '2026-08-24', amount: -50 },
    ], 2, today);
    expect(curve.find((p) => p.date === '2026-08-24')!.balance).toBe(350);
  });

  it('reports the first day the balance dips below zero', () => {
    const { negativeOn } = buildBalanceCurve(100, [
      { date: '2026-08-25', amount: -60 },
      { date: '2026-08-26', amount: -60 },
      { date: '2026-08-27', amount: -60 },
    ], 6, today);
    expect(negativeOn).toBe('2026-08-26');
  });

  it('reports no negative day when the balance stays positive', () => {
    const { negativeOn } = buildBalanceCurve(100, [{ date: '2026-08-25', amount: -60 }], 6, today);
    expect(negativeOn).toBeNull();
  });

  it('ignores forecast entries outside the window', () => {
    const { curve } = buildBalanceCurve(100, [{ date: '2026-12-01', amount: -5000 }], 3, today);
    expect(curve.every((p) => p.balance === 100)).toBe(true);
  });

  it('crosses a month boundary correctly', () => {
    const { curve } = buildBalanceCurve(0, [{ date: '2026-09-01', amount: 10 }], 10, today);
    expect(curve.find((p) => p.date === '2026-09-01')!.balance).toBe(10);
  });
});
