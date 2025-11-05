import { findDuplicateTransactions } from '../lib/budgetDb';
import type { ParsedTransaction } from '../lib/budgetDb';

const existing = [
  { date: '2026-01-15', vendor: 'Netflix', amount: -15.99 },
  { date: '2026-01-20', vendor: 'Amazon', amount: -42.50 },
  { date: '2026-02-01', vendor: 'City of Detroit', amount: 1759.44 },
];

describe('findDuplicateTransactions', () => {
  it('detects exact match', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: 'Netflix sub', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].incoming.vendor).toBe('Netflix');
  });

  it('detects near match (vendor case and spacing variants)', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-20', vendor: '  amazon  ', description: '', amount: -42.50, category: 'Shopping' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(1);
  });

  it('detects match with date within ±3 days', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-18', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(1);
  });

  it('no match when date is outside ±3 days', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-30', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(0);
  });

  it('no match when vendor is completely different', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Walmart', description: '', amount: -15.99, category: 'Shopping' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(0);
  });

  it('no match when amount differs significantly', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -9.99, category: 'Subscriptions' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(0);
  });

  it('handles multiple incoming transactions with mixed matches', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
      { date: '2026-02-01', vendor: 'City of Detroit', description: '', amount: 1759.44, category: 'Income' },
      { date: '2026-03-01', vendor: 'Unknown Vendor', description: '', amount: -25.00, category: 'Other' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when incoming is empty', () => {
    const result = findDuplicateTransactions(existing, []);
    expect(result).toEqual([]);
  });

  it('matches on vendor substring', () => {
    const incoming: ParsedTransaction[] = [
      { date: '2026-02-01', vendor: 'City of Detroit Payroll', description: '', amount: 1759.44, category: 'Income' },
    ];
    const result = findDuplicateTransactions(existing, incoming);
    expect(result).toHaveLength(1);
  });
});