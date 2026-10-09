import { baseTitle, dateRange, daysBetween, nextCycleValue, remapIds, shiftDate } from '@/lib/projects/cycle';

describe('project cycle helpers', () => {
  it('measures the gap between two key dates in days', () => {
    expect(daysBetween('2026-08-04', '2026-11-03')).toBe(91);
    expect(daysBetween('2026-11-03', '2026-08-04')).toBe(-91);
  });

  it('shifts plain and timestamped dates, leaving anything else alone', () => {
    expect(shiftDate('2026-07-08', 91)).toBe('2026-10-07');
    expect(shiftDate('2026-07-08T09:00:00.000Z', 1)).toBe('2026-07-09T09:00:00.000Z');
    expect(shiftDate('soon', 5)).toBe('soon');
    expect(shiftDate(null, 5)).toBeNull();
  });

  it('crosses a month and year boundary correctly', () => {
    expect(shiftDate('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('resets progress and keeps other values', () => {
    const status = { id: 's', type: 'select', formula: '["Not Started","In Progress","Complete"]' };
    expect(nextCycleValue(status, 'Complete', 10, true)).toBe('Not Started');
    expect(nextCycleValue({ id: 'c', type: 'checkbox' }, true, 10, false)).toBe(false);
    expect(nextCycleValue({ id: 'd', type: 'date' }, '2026-05-07', 10, false)).toBe('2026-05-17');
    expect(nextCycleValue({ id: 't', type: 'text' }, 'Alex', 10, false)).toBe('Alex');
    expect(nextCycleValue({ id: 'p', type: 'select', formula: '["High"]' }, 'High', 10, false)).toBe('High');
  });

  it('strips an old cycle label before adding the new one', () => {
    expect(baseTitle('Early Vote Center Project · Aug 2026 Primary')).toBe('Early Vote Center Project');
    expect(baseTitle('Early Vote Center Project')).toBe('Early Vote Center Project');
  });

  it('remaps copied ids inside view settings and relation values', () => {
    const ids = new Map([['oldProp', 'newProp'], ['oldPage', 'newPage']]);
    expect(remapIds({ propertyId: 'oldProp' }, ids)).toEqual({ propertyId: 'newProp' });
    expect(remapIds(['oldPage', 'other'], ids)).toEqual(['newPage', 'other']);
    expect(remapIds(null, ids)).toBeNull();
  });

  it('finds the first and last due date', () => {
    expect(dateRange(['2026-06-05', null, '2026-05-07', 'x'])).toEqual({ first: '2026-05-07', last: '2026-06-05' });
    expect(dateRange([])).toBeNull();
  });
});
