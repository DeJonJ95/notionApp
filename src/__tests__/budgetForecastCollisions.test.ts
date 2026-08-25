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
