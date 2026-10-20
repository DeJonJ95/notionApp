import { statementCoverage } from '../lib/budgetStatement';

const r = (from: string, to: string, account: string | null = null) => ({ account, from, to });

describe('statementCoverage', () => {
  it('returns nothing without a usable import', () => {
    expect(statementCoverage([])).toBeNull();
    expect(statementCoverage([r('2026-02-10', '2026-02-01'), r('soon', '2026-02-01')])).toBeNull();
  });

  it('reports how far contiguous statements reach', () => {
    expect(statementCoverage([r('2026-01-01', '2026-01-15'), r('2026-01-16', '2026-01-31')]))
      .toEqual({ account: null, from: '2026-01-01', through: '2026-01-31', gaps: [] });
  });

  it('names the missing half of September between partial uploads', () => {
    const cov = statementCoverage([
      r('2026-07-01', '2026-07-31'), r('2026-08-01', '2026-08-31'), r('2026-09-01', '2026-09-15'), r('2026-10-01', '2026-10-20'),
    ]);
    expect(cov?.through).toBe('2026-10-20');
    expect(cov?.gaps).toEqual([{ from: '2026-09-16', to: '2026-09-30', days: 15 }]);
  });

  it('bridges a quiet gap of three days or fewer', () => {
    expect(statementCoverage([r('2026-01-01', '2026-01-15'), r('2026-01-19', '2026-01-31')])?.gaps).toEqual([]);
    expect(statementCoverage([r('2026-01-01', '2026-01-15'), r('2026-01-19', '2026-01-31')], 2)?.gaps).toHaveLength(1);
  });

  it('does not invent a gap after a long import that contains a shorter one', () => {
    const cov = statementCoverage([r('2026-07-01', '2026-09-30'), r('2026-08-01', '2026-08-15'), r('2026-10-01', '2026-10-31')]);
    expect(cov?.gaps).toEqual([]);
    expect(cov?.through).toBe('2026-10-31');
  });

  it('follows the latest statement\'s account and counts unnamed imports for it', () => {
    const cov = statementCoverage([
      r('2026-05-01', '2026-08-31', 'Old Checking'),
      r('2026-07-13', '2026-08-12', 'Huntington'),
      r('2026-08-13', '2026-09-16'),
      r('2026-10-01', '2026-10-16', 'Huntington'),
    ]);
    expect(cov).toEqual({ account: 'Huntington', from: '2026-07-13', through: '2026-10-16', gaps: [{ from: '2026-09-17', to: '2026-09-30', days: 14 }] });
  });
});
