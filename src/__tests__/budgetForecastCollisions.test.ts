import { findLedgerDuplicates as findForecastCollisions } from '../lib/budgetDb';

const row = (
  pageId: string,
  date: string,
  vendor: string,
  amount: number,
  isGenerated: boolean,
) => ({ pageId, date, vendor, amount, isGenerated });

describe('findForecastCollisions', () => {
  it('catches the reported paycheck pair', () => {
    // Exactly what DeJon saw: a forecast row plus the imported real one.
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit', 3746, true),
      row('p2', '2026-08-05', 'City of Detroit Payroll', 3746, false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p1'); // the forecast, never the real row
    expect(out[0].matched.vendor).toBe('City of Detroit Payroll');
  });

  it('catches a pair whose amounts differ, which dedup never could', () => {
    const out = findForecastCollisions([
      row('p1', '2026-06-26', 'City of Detroit Paycheck', 1759.44, true),
      row('p2', '2026-06-26', 'CITY OF DETROIT PAYROLL 2606231026', 2082.44, false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p1');
  });

  it('catches a variable bill', () => {
    const out = findForecastCollisions([
      row('p1', '2026-07-01', 'DTE Energy', -120, true),
      row('p2', '2026-07-02', 'DTE ENERGY BILL PAYMT 887766', -143.87, false),
    ]);
    expect(out).toHaveLength(1);
  });

  it('leaves a forecast alone when no real transaction arrived', () => {
    expect(
      findForecastCollisions([row('p1', '2026-08-21', 'City of Detroit', 1926, true)]),
    ).toHaveLength(0);
  });

  it('catches the same real transaction imported twice, keeping the original', () => {
    // Rows arrive oldest-first, so p1 is the original.
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746, false),
      row('p2', '2026-08-05', 'City of Detroit Payroll', 3746, false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
    expect(out[0].reason).toBe('repeat-import');
  });

  it('catches a re-import where the AI cleaned the vendor differently', () => {
    // Same statement run twice through DeepSeek yields slightly different names.
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746, false),
      row('p2', '2026-08-05', 'City of Detroit', 3746, false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
  });

  it('leaves two same-day charges of different amounts alone', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-05', 'Starbucks', -4.5, false),
        row('p2', '2026-08-05', 'Starbucks', -6.75, false),
      ]),
    ).toHaveLength(0);
  });

  it('leaves the same amount on different days alone', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-05', 'Starbucks', -4.5, false),
        row('p2', '2026-08-06', 'Starbucks', -4.5, false),
      ]),
    ).toHaveLength(0);
  });

  it('removes only one copy when a row is imported three times', () => {
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746, false),
      row('p2', '2026-08-05', 'City of Detroit Payroll', 3746, false),
      row('p3', '2026-08-05', 'City of Detroit Payroll', 3746, false),
    ]);
    // p1↔p2 pair off; p3 needs another pass after those are archived.
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
  });

  it('does not let two forecasts cancel each other out', () => {
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit', 3746, true),
      row('p2', '2026-08-05', 'City of Detroit', 3746, true),
    ]);
    expect(out).toHaveLength(0);
  });

  it('settles one forecast per real transaction', () => {
    // Two forecasts, one real paycheck — only one is superseded.
    const out = findForecastCollisions([
      row('p1', '2026-08-05', 'City of Detroit', 3746, true),
      row('p2', '2026-08-06', 'City of Detroit', 3746, true),
      row('p3', '2026-08-05', 'City of Detroit Payroll', 3746, false),
    ]);
    expect(out).toHaveLength(1);
  });

  it('ignores a real transaction outside the date window', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-05', 'City of Detroit', 3746, true),
        row('p2', '2026-08-20', 'City of Detroit Payroll', 3746, false),
      ]),
    ).toHaveLength(0);
  });

  it('will not match income against an expense', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-05', 'City of Detroit', 3746, true),
        row('p2', '2026-08-05', 'City of Detroit Water', -3746, false),
      ]),
    ).toHaveLength(0);
  });

  it('ignores an unrelated vendor on the same day', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-05', 'City of Detroit', 3746, true),
        row('p2', '2026-08-05', 'Freelance Client', 3746, false),
      ]),
    ).toHaveLength(0);
  });

  it('skips rows with unusable dates instead of throwing', () => {
    expect(
      findForecastCollisions([
        row('p1', '', 'City of Detroit', 3746, true),
        row('p2', '2026-08-05', 'City of Detroit Payroll', 3746, false),
      ]),
    ).toHaveLength(0);
  });

  it('returns nothing for an empty ledger', () => {
    expect(findForecastCollisions([])).toHaveLength(0);
  });
});

// DeJon's $0.01 pair was an account-verification deposit that got refunded —
// a legitimate pair, not a duplicate. Tiny amounts are exactly where genuine
// near-identical rows live, so the repeat-import pass stays out of them.
describe('micro-transactions', () => {
  it('leaves identical trial deposits alone', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-12', 'Huntington Trial Deposit', 0.01, false),
        row('p2', '2026-08-12', 'Huntington Trial Deposit', 0.01, false),
      ]),
    ).toHaveLength(0);
  });

  it('does not treat one cent and two cents as the same amount', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-12', 'Huntington Trial Deposit', 0.01, false),
        row('p2', '2026-08-12', 'Huntington Trial Deposit', 0.02, false),
      ]),
    ).toHaveLength(0);
  });

  it('leaves a small refund paired against its charge alone', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-12', 'Huntington', -0.01, false),
        row('p2', '2026-08-12', 'Huntington', 0.01, false),
      ]),
    ).toHaveLength(0);
  });

  it('still catches a real duplicate just above the micro threshold', () => {
    const out = findForecastCollisions([
      row('p1', '2026-08-12', 'Shell Oil', -1.5, false),
      row('p2', '2026-08-12', 'Shell Oil', -1.5, false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
  });

  it('does not collapse amounts that differ by a cent', () => {
    expect(
      findForecastCollisions([
        row('p1', '2026-08-12', 'Shell Oil', -40.01, false),
        row('p2', '2026-08-12', 'Shell Oil', -40.02, false),
      ]),
    ).toHaveLength(0);
  });
});

// A bill anchored to the 25th that actually cleared on the 14th. The old
// 4-day window missed it entirely, so it sat in the ledger double-counted.
describe('forecast/real pairs that drift from the rule anchor', () => {
  it('catches an insurance premium that posted 11 days early', () => {
    const out = findForecastCollisions([
      row('real', '2026-08-14', 'Cure Auto Insurance', -253.71, false),
      row('fcast', '2026-08-25', 'NNT Cure Auto Insurance', -228.94, true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('fcast');
    expect(out[0].reason).toBe('forecast-superseded');
  });

  it('still refuses a pair beyond the window', () => {
    expect(
      findForecastCollisions([
        row('real', '2026-08-01', 'Cure Auto Insurance', -253.71, false),
        row('fcast', '2026-08-25', 'NNT Cure Auto Insurance', -228.94, true),
      ]),
    ).toHaveLength(0);
  });

  it('pairs the nearest transaction, not the first one listed', () => {
    // Two forecasts, two real charges. Naive first-match would cross them.
    const out = findForecastCollisions([
      row('realA', '2026-08-03', 'Cure Auto Insurance', -250, false),
      row('realB', '2026-08-17', 'Cure Auto Insurance', -250, false),
      row('fcastA', '2026-08-02', 'Cure Auto Insurance', -240, true),
      row('fcastB', '2026-08-16', 'Cure Auto Insurance', -240, true),
    ]);
    expect(out).toHaveLength(2);
    const byForecast = Object.fromEntries(out.map((c) => [c.pageId, c.matched.date]));
    expect(byForecast['fcastA']).toBe('2026-08-03');
    expect(byForecast['fcastB']).toBe('2026-08-17');
  });
});
