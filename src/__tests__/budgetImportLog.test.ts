import { computeCoverageGaps } from '../lib/budgetDb';

describe('computeCoverageGaps', () => {
  it('returns empty array for fewer than 2 ranges', () => {
    expect(computeCoverageGaps([])).toEqual([]);
    expect(computeCoverageGaps([{ dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-15') }])).toEqual([]);
  });

  it('returns empty array for contiguous coverage with no gaps', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-15') },
      { dateFrom: new Date('2026-01-16'), dateTo: new Date('2026-01-31') },
    ];
    expect(computeCoverageGaps(ranges)).toEqual([]);
  });

  it('detects a gap between two ranges', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-15') },
      { dateFrom: new Date('2026-01-25'), dateTo: new Date('2026-01-31') },
    ];
    const gaps = computeCoverageGaps(ranges);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ from: '2026-01-16', to: '2026-01-24', days: 9 });
  });

  it('ignores gaps smaller than minGapDays', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-15') },
      { dateFrom: new Date('2026-01-17'), dateTo: new Date('2026-01-31') },
    ];
    // Gap is 1 day, default minGapDays is 3
    expect(computeCoverageGaps(ranges)).toEqual([]);
  });

  it('handles overlapping ranges (no gap)', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-20') },
      { dateFrom: new Date('2026-01-15'), dateTo: new Date('2026-01-31') },
    ];
    expect(computeCoverageGaps(ranges)).toEqual([]);
  });

  it('detects multiple gaps', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-10') },
      { dateFrom: new Date('2026-01-20'), dateTo: new Date('2026-01-25') },
      { dateFrom: new Date('2026-02-05'), dateTo: new Date('2026-02-10') },
    ];
    const gaps = computeCoverageGaps(ranges);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].days).toBe(9);
    expect(gaps[1].days).toBe(10);
  });

  it('respects custom minGapDays parameter', () => {
    const ranges = [
      { dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-01-10') },
      { dateFrom: new Date('2026-01-14'), dateTo: new Date('2026-01-20') },
    ];
    // Gap is 3 days — with minGapDays=2, this qualifies
    const gaps = computeCoverageGaps(ranges, 2);
    expect(gaps).toHaveLength(1);
    // With minGapDays=5, it does not
    expect(computeCoverageGaps(ranges, 5)).toEqual([]);
  });
});