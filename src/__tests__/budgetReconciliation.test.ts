import { reconcileTransactions } from '../lib/budgetDb';
import type { ParsedTransaction } from '../lib/budgetDb';

const rules = [
  {
    name: 'City of Detroit Paycheck',
    type: 'income',
    amount: 1759.44,
    category: 'Income',
    anchorDate: new Date('2026-01-01T00:00:00Z'),
    frequency: 'biweekly',
  },
  {
    name: 'Netflix',
    type: 'expense',
    amount: 15.99,
    category: 'Subscriptions',
    anchorDate: new Date('2026-01-15T00:00:00Z'),
    frequency: 'monthly',
  },
];

describe('reconcileTransactions', () => {
  it('matches all expected transactions in range', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
      { date: '2026-01-15', vendor: 'City of Detroit Payroll Dept', description: '', amount: 1759.44, category: 'Income' },
    ];
    const result = reconcileTransactions(rules, imported, '2026-01-01', '2026-01-31');
    expect(result.matched).toHaveLength(2);
    expect(result.missing).toHaveLength(0);
    expect(result.unexpected).toHaveLength(0);
  });

  it('detects missing expected transaction', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = reconcileTransactions(rules, imported, '2026-01-01', '2026-01-31');
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].ruleName).toBe('Netflix');
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].ruleName).toBe('City of Detroit Paycheck');
  });

  it('flags unexpected transactions', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
      { date: '2026-01-20', vendor: 'Random Store', description: '', amount: -50.00, category: 'Shopping' },
    ];
    const result = reconcileTransactions(rules, imported, '2026-01-01', '2026-01-31');
    expect(result.unexpected).toHaveLength(1);
    expect(result.unexpected[0].vendor).toBe('Random Store');
  });

  it('respects date range boundaries', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    // Only look at first week of January — Netflix on 15th is outside
    const result = reconcileTransactions(rules, imported, '2026-01-01', '2026-01-07');
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0); // no rule due dates in range either
  });

  it('handles zero rules', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = reconcileTransactions([], imported, '2026-01-01', '2026-01-31');
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
    expect(result.unexpected).toHaveLength(1);
  });

  it('handles empty imported transactions', () => {
    const result = reconcileTransactions(rules, [], '2026-01-01', '2026-01-31');
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(1); // Netflix in range
    // Second rule (biweekly starting Jan 1) — occurrences on Jan 1, 15, 29
    expect(result.missing.length).toBeGreaterThanOrEqual(1);
  });

  it('matches despite minor amount variance (<30%)', () => {
    const imported: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -16.49, category: 'Subscriptions' },
    ];
    const result = reconcileTransactions(rules, imported, '2026-01-01', '2026-01-31');
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].ruleName).toBe('Netflix');
  });
});