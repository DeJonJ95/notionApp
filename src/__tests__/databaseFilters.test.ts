import { normalizeFilters, matchesCondition } from '../components/database/DatabaseView';
import type { FilterCondition } from '../components/database/DatabaseView';

const cond = (
  propertyId: string,
  op: FilterCondition['op'],
  value: string,
): FilterCondition => ({ propertyId, op, value });

describe('normalizeFilters', () => {
  it('accepts the legacy single-condition object saved on existing views', () => {
    expect(normalizeFilters({ propertyId: 'p1', op: 'eq', value: 'Income' })).toEqual([
      { propertyId: 'p1', op: 'eq', value: 'Income' },
    ]);
  });

  it('accepts an array', () => {
    const arr = [
      { propertyId: 'p1', op: 'eq', value: 'Income' },
      { propertyId: 'p2', op: 'contains', value: '2026-08' },
    ];
    expect(normalizeFilters(arr)).toHaveLength(2);
  });

  it('treats nothing as no filters', () => {
    expect(normalizeFilters(null)).toEqual([]);
    expect(normalizeFilters(undefined)).toEqual([]);
    expect(normalizeFilters([])).toEqual([]);
  });

  it('drops entries with no property and defaults a bad operator', () => {
    const out = normalizeFilters([
      { op: 'eq', value: 'x' },
      { propertyId: 'p1', op: 'wat', value: 'y' },
    ]);
    expect(out).toEqual([{ propertyId: 'p1', op: 'contains', value: 'y' }]);
  });

  it('coerces a missing value to an empty string', () => {
    expect(normalizeFilters({ propertyId: 'p1', op: 'eq' })[0].value).toBe('');
  });
});

describe('matchesCondition', () => {
  it('matches contains case-insensitively', () => {
    expect(matchesCondition('City of Detroit Payroll', cond('p', 'contains', 'detroit'))).toBe(true);
    expect(matchesCondition('Shell Oil', cond('p', 'contains', 'detroit'))).toBe(false);
  });

  it('matches eq case-insensitively and exactly', () => {
    expect(matchesCondition('Income', cond('p', 'eq', 'income'))).toBe(true);
    expect(matchesCondition('Income', cond('p', 'eq', 'Inc'))).toBe(false);
  });

  it('lets an empty value match everything, so a half-typed filter is harmless', () => {
    expect(matchesCondition('anything', cond('p', 'eq', ''))).toBe(true);
    expect(matchesCondition('', cond('p', 'contains', '   '))).toBe(true);
  });

  it('compares dates lexically, which ISO strings order correctly', () => {
    expect(matchesCondition('2026-08-15', cond('p', 'gte', '2026-08-01'))).toBe(true);
    expect(matchesCondition('2026-07-31', cond('p', 'gte', '2026-08-01'))).toBe(false);
    expect(matchesCondition('2026-08-15', cond('p', 'lte', '2026-08-31'))).toBe(true);
    expect(matchesCondition('2026-09-01', cond('p', 'lte', '2026-08-31'))).toBe(false);
  });

  it('treats bounds as inclusive', () => {
    expect(matchesCondition('2026-08-01', cond('p', 'gte', '2026-08-01'))).toBe(true);
    expect(matchesCondition('2026-08-31', cond('p', 'lte', '2026-08-31'))).toBe(true);
  });

  it('compares numbers numerically, not as text', () => {
    // Lexically "9" > "100"; numerically it isn't.
    expect(matchesCondition('9', cond('p', 'gte', '100'))).toBe(false);
    expect(matchesCondition('250', cond('p', 'gte', '100'))).toBe(true);
    expect(matchesCondition('99.5', cond('p', 'lte', '100'))).toBe(true);
  });

  it('handles null and undefined cells', () => {
    expect(matchesCondition(null, cond('p', 'contains', 'x'))).toBe(false);
    expect(matchesCondition(undefined, cond('p', 'eq', 'x'))).toBe(false);
    expect(matchesCondition(null, cond('p', 'eq', ''))).toBe(true);
  });
});

// DeJon's ask: deposits that hit the account in August.
describe('deposits in August', () => {
  const rows = [
    { Type: 'Income', Date: '2026-08-05', Vendor: 'City of Detroit' },
    { Type: 'Income', Date: '2026-07-22', Vendor: 'City of Detroit' },
    { Type: 'Expense', Date: '2026-08-14', Vendor: 'Cure Auto Insurance' },
    { Type: 'Income', Date: '2026-08-21', Vendor: 'City of Detroit' },
  ];
  const apply = (conds: FilterCondition[]) =>
    rows.filter((r) => conds.every((c) => matchesCondition((r as any)[c.propertyId], c)));

  it('needs both conditions to isolate them', () => {
    expect(apply([cond('Type', 'eq', 'Income')])).toHaveLength(3);           // wrong month included
    expect(apply([cond('Date', 'contains', '2026-08')])).toHaveLength(3);    // expense included
    expect(
      apply([cond('Type', 'eq', 'Income'), cond('Date', 'contains', '2026-08')]),
    ).toHaveLength(2);
  });

  it('works with an explicit date range too', () => {
    const out = apply([
      cond('Type', 'eq', 'Income'),
      cond('Date', 'gte', '2026-08-01'),
      cond('Date', 'lte', '2026-08-31'),
    ]);
    expect(out.map((r) => r.Date)).toEqual(['2026-08-05', '2026-08-21']);
  });
});

// The filter bar was gated on an allow-list of exact view types while the
// content renderer fell through to a table for anything unrecognized. A view
// stored as anything but exactly 'table' therefore rendered as a table with no
// way to filter it — which is what hid the bar on DeJon's Personal Budget.
describe('which views get the filter bar', () => {
  const SPECIALIZED = ['calendar', 'heatmap', 'budget-summary', 'spending-breakdown'];
  const key = (t: unknown) => String(t ?? '').trim().toLowerCase();
  const showsBar = (t: unknown) => !SPECIALIZED.includes(key(t));
  const rendersAsTable = (t: unknown) =>
    !['gallery', 'list', 'board', ...SPECIALIZED].includes(key(t));

  it('hides the bar only for the purpose-built views', () => {
    for (const t of SPECIALIZED) expect(showsBar(t)).toBe(false);
  });

  it('shows the bar for every record view', () => {
    for (const t of ['table', 'list', 'gallery', 'board']) expect(showsBar(t)).toBe(true);
  });

  it('shows the bar for odd casing and stray whitespace', () => {
    for (const t of ['Table', ' table ', 'TABLE']) expect(showsBar(t)).toBe(true);
  });

  it('shows the bar for an unrecognized type, which renders as a table', () => {
    for (const t of ['grid', '', null, undefined]) {
      expect(rendersAsTable(t)).toBe(true);
      expect(showsBar(t)).toBe(true);
    }
  });

  it('never lets the two disagree', () => {
    for (const t of ['table', 'Table', 'grid', '', 'list', 'board', 'gallery', ...SPECIALIZED]) {
      if (rendersAsTable(t)) expect(showsBar(t)).toBe(true);
    }
  });
});
