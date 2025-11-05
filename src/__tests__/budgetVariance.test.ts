import { computeRuleVariance } from '../lib/budgetDb';
import type { ParsedTransaction } from '../lib/budgetDb';

describe('computeRuleVariance', () => {
  it('returns 0 variance for identical amounts', () => {
    const transactions: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
      { date: '2026-02-15', vendor: 'Netflix', description: '', amount: -15.99, category: 'Subscriptions' },
    ];
    const result = computeRuleVariance(15.99, transactions);
    expect(result.averageVariance).toBe(0);
    expect(result.variancePercent).toBe(0);
    expect(result.suggestedAmount).toBe(15.99);
    expect(result.sampleCount).toBe(2);
  });

  it('computes correct average for varying amounts', () => {
    const transactions: ParsedTransaction[] = [
      { date: '2026-01-01', vendor: 'Electric Co', description: '', amount: -85.00, category: 'Utilities' },
      { date: '2026-02-01', vendor: 'Electric Co', description: '', amount: -95.00, category: 'Utilities' },
      { date: '2026-03-01', vendor: 'Electric Co', description: '', amount: -90.00, category: 'Utilities' },
    ];
    const result = computeRuleVariance(85.00, transactions);
    expect(result.averageAmount).toBe(90);
    expect(result.averageVariance).toBe(5);
    expect(result.suggestedAmount).toBe(90);
    expect(result.sampleCount).toBe(3);
  });

  it('returns rule amount when no matches (empty)', () => {
    const result = computeRuleVariance(50.00, []);
    expect(result.averageAmount).toBe(50);
    expect(result.variancePercent).toBe(0);
    expect(result.suggestedAmount).toBe(50);
    expect(result.sampleCount).toBe(0);
  });

  it('handles single transaction', () => {
    const transactions: ParsedTransaction[] = [
      { date: '2026-01-15', vendor: 'Test', description: '', amount: -100.00, category: 'Other' },
    ];
    const result = computeRuleVariance(100.00, transactions);
    expect(result.averageAmount).toBe(100);
    expect(result.variancePercent).toBe(0);
    expect(result.averageVariance).toBe(0);
    expect(result.sampleCount).toBe(1);
  });

  it('computes correct variance percent', () => {
    const transactions: ParsedTransaction[] = [
      { date: '2026-01-01', vendor: 'Rent', description: '', amount: -1200.00, category: 'Housing' },
    ];
    const result = computeRuleVariance(1000.00, transactions);
    expect(result.averageAmount).toBe(1200);
    expect(result.averageVariance).toBe(200);
    expect(result.variancePercent).toBe(20);
    expect(result.suggestedAmount).toBe(1200);
  });

  it('minAmount and maxAmount are correct', () => {
    const transactions: ParsedTransaction[] = [
      { date: '2026-01-01', vendor: 'Gas', description: '', amount: -45.00, category: 'Utilities' },
      { date: '2026-02-01', vendor: 'Gas', description: '', amount: -55.00, category: 'Utilities' },
      { date: '2026-03-01', vendor: 'Gas', description: '', amount: -38.00, category: 'Utilities' },
    ];
    const result = computeRuleVariance(45.00, transactions);
    expect(result.minAmount).toBe(38);
    expect(result.maxAmount).toBe(55);
    expect(result.averageAmount).toBe(46);
  });
});