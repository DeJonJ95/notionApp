import { detectRecurringPatterns } from '../lib/budgetDb';

const TX = (vendor: string, amount: number, date: string, category: string = 'Shopping') => ({
  vendor, amount, date, category,
});

describe('detectRecurringPatterns', () => {
  it('detects bi-weekly pattern (14-day intervals)', () => {
    const transactions = [
      TX('City of Detroit', 1759.44, '2026-01-01', 'Income'),
      TX('City of Detroit', 1759.44, '2026-01-15', 'Income'),
      TX('City of Detroit', 1759.44, '2026-01-29', 'Income'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe('biweekly');
    expect(result[0].vendor).toBe('City of Detroit');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects monthly pattern (28-31 day intervals)', () => {
    const transactions = [
      TX('Netflix', 15.99, '2026-01-15', 'Subscriptions'),
      TX('Netflix', 15.99, '2026-02-15', 'Subscriptions'),
      TX('Netflix', 15.99, '2026-03-15', 'Subscriptions'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe('monthly');
    expect(result[0].vendor).toBe('Netflix');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects weekly pattern (7-day intervals)', () => {
    const transactions = [
      TX('Coffee Shop', 4.50, '2026-01-06', 'Food & Dining'),
      TX('Coffee Shop', 4.50, '2026-01-13', 'Food & Dining'),
      TX('Coffee Shop', 4.50, '2026-01-20', 'Food & Dining'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe('weekly');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('does not flag irregular intervals', () => {
    const transactions = [
      TX('Random Store', 25.00, '2026-01-05', 'Shopping'),
      TX('Random Store', 15.00, '2026-02-20', 'Shopping'),
      TX('Random Store', 30.00, '2026-04-10', 'Shopping'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    const match = result.find((r) => r.vendor === 'Random Store');
    expect(match).toBeUndefined();
  });

  it('excludes vendors that already have a recurring rule', () => {
    const transactions = [
      TX('Netflix', 15.99, '2026-01-15', 'Subscriptions'),
      TX('Netflix', 15.99, '2026-02-15', 'Subscriptions'),
      TX('Netflix', 15.99, '2026-03-15', 'Subscriptions'),
    ];
    const result = detectRecurringPatterns(transactions, [{ name: 'Netflix' }]);
    const match = result.find((r) => r.vendor === 'Netflix');
    expect(match).toBeUndefined();
  });

  it('requires at least 3 occurrences', () => {
    const transactions = [
      TX('Biweekly Bill', 100.00, '2026-01-15', 'Utilities'),
      TX('Biweekly Bill', 100.00, '2026-01-29', 'Utilities'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    const match = result.find((r) => r.vendor === 'Biweekly Bill');
    expect(match).toBeUndefined();
  });

  it('classifies as income when most amounts are positive', () => {
    const transactions = [
      TX('Freelance', 500.00, '2026-01-01', 'Income'),
      TX('Freelance', 500.00, '2026-01-15', 'Income'),
      TX('Freelance', 500.00, '2026-01-29', 'Income'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    const match = result.find((r) => r.vendor === 'Freelance');
    expect(match).toBeDefined();
    expect(match!.type).toBe('income');
  });

  it('returns empty array for empty transactions', () => {
    const result = detectRecurringPatterns([], []);
    expect(result).toEqual([]);
  });

  it('detects semimonthly pattern', () => {
    const transactions = [
      TX('Partial Salary', 1000.00, '2026-01-01', 'Income'),
      TX('Partial Salary', 1000.00, '2026-01-15', 'Income'),
      TX('Partial Salary', 1000.00, '2026-02-01', 'Income'),
      TX('Partial Salary', 1000.00, '2026-02-15', 'Income'),
    ];
    const result = detectRecurringPatterns(transactions, []);
    const match = result.find((r) => r.vendor === 'Partial Salary');
    expect(match).toBeDefined();
    expect(match!.frequency).toBe('semimonthly');
  });
});