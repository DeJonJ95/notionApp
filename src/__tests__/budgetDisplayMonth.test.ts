import { resolveDisplayMonth } from '../lib/budgetDb';

const NOW = new Date(2026, 7, 23); // Aug 23 2026

const label = (r: { start: Date; end: Date }) =>
  `${r.start.getFullYear()}-${String(r.start.getMonth() + 1).padStart(2, '0')}`;

describe('resolveDisplayMonth', () => {
  it('honours an explicit month even when the current month has data', () => {
    const r = resolveDisplayMonth('2026-03', ['2026-08-05', '2026-03-14'], NOW);
    expect(label(r)).toBe('2026-03');
    expect(r.start).toEqual(new Date(2026, 2, 1));
    expect(r.end).toEqual(new Date(2026, 3, 1)); // exclusive
  });

  it('honours a month with no data at all', () => {
    expect(label(resolveDisplayMonth('2025-11', ['2026-08-05'], NOW))).toBe('2025-11');
  });

  it('honours a future month', () => {
    expect(label(resolveDisplayMonth('2026-12', ['2026-08-05'], NOW))).toBe('2026-12');
  });

  it('defaults to the current month when it has transactions', () => {
    expect(label(resolveDisplayMonth(null, ['2026-08-05', '2026-07-01'], NOW))).toBe('2026-08');
  });

  it('falls back to the latest month with data when the current month is empty', () => {
    expect(label(resolveDisplayMonth(null, ['2026-05-02', '2026-06-30', '2026-04-11'], NOW))).toBe('2026-06');
  });

  it('defaults to the current month when there are no transactions', () => {
    expect(label(resolveDisplayMonth(null, [], NOW))).toBe('2026-08');
  });

  it('ignores malformed month params rather than erroring', () => {
    for (const bad of ['2026-13', '2026-00', 'August', '2026-8', '202608', '', '2026-08-01']) {
      expect(label(resolveDisplayMonth(bad, ['2026-08-05'], NOW))).toBe('2026-08');
    }
  });

  it('treats undefined the same as null', () => {
    expect(label(resolveDisplayMonth(undefined, ['2026-06-30'], NOW))).toBe('2026-06');
  });

  it('ignores malformed transaction dates when picking the fallback month', () => {
    expect(label(resolveDisplayMonth(null, ['', 'not-a-date', '2026-02-09'], NOW))).toBe('2026-02');
  });

  it('rolls the exclusive end into the next year for December', () => {
    const r = resolveDisplayMonth('2026-12', [], NOW);
    expect(r.end).toEqual(new Date(2027, 0, 1));
  });
});
