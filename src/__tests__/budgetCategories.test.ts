import {
  DEFAULT_CATEGORIES,
  parseCategoryOptions,
  fallbackCategory,
} from '../lib/budgetCategories';
import { getBudgetCategories } from '../lib/budgetDb';
import type { BudgetDb } from '../lib/budgetDb';

const dbWith = (properties: BudgetDb['properties']): BudgetDb => ({
  id: 'db1',
  name: 'Personal Budget',
  properties,
});

const prop = (name: string, formula: string | null) =>
  ({ id: `p-${name}`, name, type: 'select', formula });

describe('parseCategoryOptions', () => {
  it('returns the stored options', () => {
    expect(parseCategoryOptions('["Rent","Coffee","Other"]')).toEqual(['Rent', 'Coffee', 'Other']);
  });

  it('keeps user-added options the defaults do not have', () => {
    const opts = parseCategoryOptions('["Housing","Pet Care","Other"]');
    expect(opts).toContain('Pet Care');
  });

  it('trims whitespace and drops blank entries', () => {
    expect(parseCategoryOptions('["  Rent  ","","   ","Other"]')).toEqual(['Rent', 'Other']);
  });

  it('falls back to defaults on malformed JSON', () => {
    expect(parseCategoryOptions('not json')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions('{"a":1}')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions('"Rent"')).toBe(DEFAULT_CATEGORIES);
  });

  it('falls back to defaults on empty or missing values', () => {
    expect(parseCategoryOptions('[]')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions('["","  "]')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions(null)).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions(undefined)).toBe(DEFAULT_CATEGORIES);
    expect(parseCategoryOptions('')).toBe(DEFAULT_CATEGORIES);
  });

  it('coerces non-string entries rather than dropping them', () => {
    expect(parseCategoryOptions('["Rent",42]')).toEqual(['Rent', '42']);
  });
});

describe('fallbackCategory', () => {
  it('prefers Other when present', () => {
    expect(fallbackCategory(['Rent', 'Other', 'Food'])).toBe('Other');
  });

  it('uses the first option when Other was removed', () => {
    expect(fallbackCategory(['Rent', 'Food'])).toBe('Rent');
  });

  it('degrades to Other for an empty list', () => {
    expect(fallbackCategory([])).toBe('Other');
  });
});

describe('getBudgetCategories', () => {
  it('reads the Category property options', () => {
    const db = dbWith([prop('Type', '["Income"]'), prop('Category', '["Rent","Other"]')]);
    expect(getBudgetCategories(db)).toEqual(['Rent', 'Other']);
  });

  it('falls back to defaults when there is no Category property', () => {
    expect(getBudgetCategories(dbWith([prop('Type', '["Income"]')]))).toBe(DEFAULT_CATEGORIES);
  });

  it('falls back to defaults when the Category options are unreadable', () => {
    expect(getBudgetCategories(dbWith([prop('Category', 'broken')]))).toBe(DEFAULT_CATEGORIES);
    expect(getBudgetCategories(dbWith([prop('Category', null)]))).toBe(DEFAULT_CATEGORIES);
  });
});
