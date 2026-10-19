import { parseMeta, statementRange } from '../lib/budgetStatement';

describe('parseMeta', () => {
  it('reads the printed period and drops anything that is not a real date', () => {
    expect(parseMeta({ meta: { account: ' Checking 1234 ', closingBalance: '1187.65', periodStart: '2026-09-05', periodEnd: '2026-10-04' } }))
      .toEqual({ account: 'Checking 1234', openingBalance: null, closingBalance: 1187.65, periodStart: '2026-09-05', periodEnd: '2026-10-04' });
    expect(parseMeta({ meta: { periodStart: '09/05/26', periodEnd: '2026-13-45' } })).toMatchObject({ periodStart: null, periodEnd: null });
    expect(parseMeta(null).periodStart).toBeNull();
  });
});

describe('statementRange', () => {
  const txs = ['2026-09-06', '2026-09-30', '2026-09-12'];

  it('covers the whole printed period, including days with no transactions', () => {
    expect(statementRange({ periodStart: '2026-09-05', periodEnd: '2026-10-04' }, txs)).toEqual({ from: '2026-09-05', to: '2026-10-04' });
  });

  it('falls back to the transaction span without a usable period', () => {
    const span = { from: '2026-09-06', to: '2026-09-30' };
    expect(statementRange(null, txs)).toEqual(span);
    expect(statementRange({ periodStart: '2026-10-04', periodEnd: '2026-09-05' }, txs)).toEqual(span);
    expect(statementRange({ periodStart: '2025-09-05', periodEnd: '2025-10-04' }, txs)).toEqual(span);
    expect(statementRange({ periodStart: '2026-06-01', periodEnd: '2026-10-04' }, txs)).toEqual(span);
  });

  it('still reaches a transaction that posted just outside the printed period', () => {
    expect(statementRange({ periodStart: '2026-09-07', periodEnd: '2026-10-04' }, txs)).toEqual({ from: '2026-09-06', to: '2026-10-04' });
  });

  it('returns nothing when no transaction has a date', () => {
    expect(statementRange({ periodStart: '2026-09-05', periodEnd: '2026-10-04' }, ['', 'soon'])).toBeNull();
  });
});
