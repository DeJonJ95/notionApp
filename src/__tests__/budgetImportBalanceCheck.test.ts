import { checkImportBalances } from '../lib/budgetDb';

const imp = (
  id: string,
  account: string | null,
  openingBalance: number | null,
  closingBalance: number | null,
  from = '2026-08-01',
  to = '2026-08-31',
) => ({
  id,
  account,
  openingBalance,
  closingBalance,
  dateFrom: new Date(from + 'T00:00:00'),
  dateTo: new Date(to + 'T00:00:00'),
});

const tx = (date: string, amount: number, account: string | null = 'Checking') => ({
  date,
  amount,
  account,
});

describe('checkImportBalances', () => {
  it('reports no discrepancy when the rows account for the balance change', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 1000, 1200)],
      [tx('2026-08-05', 500), tx('2026-08-10', -300)],
    );
    expect(check.expectedNet).toBe(200);
    expect(check.actualNet).toBe(200);
    expect(check.discrepancy).toBe(0);
    expect(check.txCount).toBe(2);
  });

  // DeJon's case: an Apple Cash credit the extraction never produced.
  it('surfaces a missing deposit as the exact amount unaccounted for', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 1000, 1679.34)],
      [tx('2026-08-05', 200)], // the $479.34 credit never made it in
    );
    expect(check.expectedNet).toBe(679.34);
    expect(check.actualNet).toBe(200);
    expect(check.discrepancy).toBe(479.34);
  });

  it('reports a negative discrepancy when rows were double-counted', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 1000, 1200)],
      [tx('2026-08-05', 200), tx('2026-08-05', 200)],
    );
    expect(check.discrepancy).toBe(-200);
  });

  it('ignores transactions outside the statement period', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 0, 100, '2026-08-01', '2026-08-31')],
      [tx('2026-08-15', 100), tx('2026-09-02', 5000), tx('2026-07-30', -900)],
    );
    expect(check.discrepancy).toBe(0);
    expect(check.txCount).toBe(1);
  });

  it('counts the period ends inclusively', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 0, 30, '2026-08-01', '2026-08-31')],
      [tx('2026-08-01', 10), tx('2026-08-31', 20)],
    );
    expect(check.discrepancy).toBe(0);
    expect(check.txCount).toBe(2);
  });

  it('keeps accounts separate so one statement cannot borrow another rows', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 0, 100)],
      [tx('2026-08-05', 100, 'Checking'), tx('2026-08-06', 999, 'Savings')],
    );
    expect(check.discrepancy).toBe(0);
  });

  it('an import with no account only claims unattributed rows', () => {
    const [check] = checkImportBalances(
      [imp('i1', null, 0, 50)],
      [tx('2026-08-05', 50, null), tx('2026-08-06', 400, 'Checking')],
    );
    expect(check.account).toBeNull();
    expect(check.discrepancy).toBe(0);
    expect(check.txCount).toBe(1);
  });

  it('skips imports missing either balance rather than guessing', () => {
    expect(
      checkImportBalances(
        [imp('i1', 'Checking', null, 100), imp('i2', 'Checking', 100, null), imp('i3', 'C', null, null)],
        [tx('2026-08-05', 10)],
      ),
    ).toHaveLength(0);
  });

  it('handles a credit-card statement, where balances are negative', () => {
    // Owed 500, paid 200 off, charged 50 more → owed 350.
    const [check] = checkImportBalances(
      [imp('card', 'Visa', -500, -350)],
      [tx('2026-08-05', 200, 'Visa'), tx('2026-08-09', -50, 'Visa')],
    );
    expect(check.expectedNet).toBe(150);
    expect(check.discrepancy).toBe(0);
  });

  it('rounds to cents rather than drifting on float noise', () => {
    const [check] = checkImportBalances(
      [imp('i1', 'Checking', 0, 0.3)],
      [tx('2026-08-05', 0.1), tx('2026-08-06', 0.2)],
    );
    expect(check.discrepancy).toBe(0);
  });

  it('returns nothing when there are no imports', () => {
    expect(checkImportBalances([], [tx('2026-08-05', 10)])).toHaveLength(0);
  });
});
