import { findLedgerDuplicates } from '../lib/budgetDb';

const row = (pageId: string, date: string, vendor: string, amount: number) => ({ pageId, date, vendor, amount });

describe('findLedgerDuplicates', () => {
  it('catches the same real transaction imported twice, keeping the original', () => {
    // Rows arrive oldest-first, so p1 is the original.
    const out = findLedgerDuplicates([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746),
      row('p2', '2026-08-05', 'City of Detroit Payroll', 3746),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
    expect(out[0].reason).toBe('repeat-import');
  });

  it('catches a re-import where the AI cleaned the vendor differently', () => {
    // Same statement run twice through DeepSeek yields slightly different names.
    const out = findLedgerDuplicates([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746),
      row('p2', '2026-08-05', 'City of Detroit', 3746),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe('p2');
  });

  it('leaves two same-day charges of different amounts alone', () => {
    expect(findLedgerDuplicates([row('p1', '2026-08-05', 'Starbucks', -4.5), row('p2', '2026-08-05', 'Starbucks', -6.75)])).toHaveLength(0);
  });

  it('leaves the same amount on different days alone', () => {
    expect(findLedgerDuplicates([row('p1', '2026-08-05', 'Starbucks', -4.5), row('p2', '2026-08-06', 'Starbucks', -4.5)])).toHaveLength(0);
  });

  it('removes only one copy when a row is imported three times', () => {
    const out = findLedgerDuplicates([
      row('p1', '2026-08-05', 'City of Detroit Payroll', 3746),
      row('p2', '2026-08-05', 'City of Detroit Payroll', 3746),
      row('p3', '2026-08-05', 'City of Detroit Payroll', 3746),
    ]);
    // p1 and p2 pair off; p3 needs another pass after those are archived.
    expect(out.map((c) => c.pageId)).toEqual(['p2']);
  });

  it('skips rows with unusable dates instead of throwing', () => {
    expect(findLedgerDuplicates([row('p1', '', 'Shell', -40), row('p2', '', 'Shell', -40)])).toHaveLength(0);
    expect(findLedgerDuplicates([])).toHaveLength(0);
  });
});

// DeJon's $0.01 pair was an account-verification deposit that got refunded:
// a legitimate pair, not a duplicate. Tiny amounts are exactly where genuine
// near-identical rows live, so the check stays out of them.
describe('micro-transactions', () => {
  it('leaves identical trial deposits and their refund alone', () => {
    expect(findLedgerDuplicates([row('p1', '2026-08-12', 'Huntington Trial Deposit', 0.01), row('p2', '2026-08-12', 'Huntington Trial Deposit', 0.01)])).toHaveLength(0);
    expect(findLedgerDuplicates([row('p1', '2026-08-12', 'Huntington', -0.01), row('p2', '2026-08-12', 'Huntington', 0.01)])).toHaveLength(0);
  });

  it('still catches a real duplicate just above the threshold, but not amounts a cent apart', () => {
    expect(findLedgerDuplicates([row('p1', '2026-08-12', 'Shell Oil', -1.5), row('p2', '2026-08-12', 'Shell Oil', -1.5)]).map((c) => c.pageId)).toEqual(['p2']);
    expect(findLedgerDuplicates([row('p1', '2026-08-12', 'Shell Oil', -40.01), row('p2', '2026-08-12', 'Shell Oil', -40.02)])).toHaveLength(0);
  });
});
