import { matchCategorizationRule } from '../lib/budgetDb';

const rule = (match: string, category: string, minAmount?: number, maxAmount?: number) => ({
  match,
  category,
  minAmount: minAmount ?? null,
  maxAmount: maxAmount ?? null,
});

describe('matchCategorizationRule', () => {
  it('matches on a vendor substring, case-insensitively', () => {
    const rules = [rule('netflix', 'Subscriptions')];
    expect(matchCategorizationRule('NETFLIX.COM', -15.99, rules)?.category).toBe('Subscriptions');
  });

  it('returns null when nothing matches', () => {
    expect(matchCategorizationRule('Shell Oil', -40, [rule('netflix', 'Subscriptions')])).toBeNull();
  });

  it('returns null for an empty rule list', () => {
    expect(matchCategorizationRule('Shell Oil', -40, [])).toBeNull();
  });

  // DeJon's case: money to a family member is large; his own Apple Pay use is small.
  describe('amount bounds', () => {
    const rules = [
      rule('zelle', 'Family Support', 200),
      rule('zelle', 'Shopping', undefined, 200),
    ];

    it('picks the over-threshold rule for a large payment', () => {
      expect(matchCategorizationRule('ZELLE TO JANE', -450, rules)?.category).toBe('Family Support');
    });

    it('picks the under-threshold rule for a small one', () => {
      expect(matchCategorizationRule('ZELLE PAYMENT', -12.5, rules)?.category).toBe('Shopping');
    });

    it('treats the minimum as inclusive', () => {
      expect(matchCategorizationRule('ZELLE', -200, rules)?.category).toBe('Family Support');
    });

    it('ignores the income/expense sign, so bounds are plain dollars', () => {
      expect(matchCategorizationRule('ZELLE FROM JANE', 450, rules)?.category).toBe('Family Support');
    });
  });

  it('skips a rule whose bounds exclude the amount', () => {
    expect(matchCategorizationRule('ZELLE', -50, [rule('zelle', 'Family Support', 200)])).toBeNull();
  });

  it('honours a maximum on its own', () => {
    const rules = [rule('apple', 'Shopping', undefined, 50)];
    expect(matchCategorizationRule('APPLE PAY', -20, rules)?.category).toBe('Shopping');
    expect(matchCategorizationRule('APPLE PAY', -80, rules)).toBeNull();
  });

  it('honours a range', () => {
    const rules = [rule('venmo', 'Family Support', 100, 500)];
    expect(matchCategorizationRule('VENMO', -300, rules)?.category).toBe('Family Support');
    expect(matchCategorizationRule('VENMO', -600, rules)).toBeNull();
    expect(matchCategorizationRule('VENMO', -50, rules)).toBeNull();
  });

  it('prefers a bounded rule over an unbounded one', () => {
    const rules = [rule('zelle', 'Other'), rule('zelle', 'Family Support', 200)];
    expect(matchCategorizationRule('ZELLE', -450, rules)?.category).toBe('Family Support');
    // Below the bound, the unbounded rule is what is left.
    expect(matchCategorizationRule('ZELLE', -10, rules)?.category).toBe('Other');
  });

  it('prefers the longer match when both are equally bounded', () => {
    const rules = [rule('zelle', 'Other'), rule('zelle to jane', 'Family Support')];
    expect(matchCategorizationRule('ZELLE TO JANE DOE', -450, rules)?.category).toBe('Family Support');
  });

  it('ignores blank match text rather than matching everything', () => {
    expect(matchCategorizationRule('Anything', -10, [rule('   ', 'Shopping')])).toBeNull();
  });

  it('tolerates a missing vendor', () => {
    expect(matchCategorizationRule('', -10, [rule('zelle', 'Shopping')])).toBeNull();
  });

  it('works with bounds left undefined rather than null', () => {
    const legacy = [{ match: 'netflix', category: 'Subscriptions' }];
    expect(matchCategorizationRule('Netflix', -15.99, legacy)?.category).toBe('Subscriptions');
  });
});
