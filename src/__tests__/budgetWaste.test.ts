import {
  matchFeeLabel,
  findFeeWaste,
  findPriceCreep,
  findSubscriptionWaste,
  findCategoryDrift,
  medianOf,
  type WasteTx,
} from '../lib/budgetWaste';

const tx = (
  date: string,
  vendor: string,
  amount: number,
  category = 'Other',
  notes?: string,
): WasteTx => ({ date, vendor, amount, category, notes });

const NOW = new Date(2026, 7, 25); // Aug 25 2026 → latest complete month is July

describe('matchFeeLabel', () => {
  it('spots real fee language', () => {
    expect(matchFeeLabel(tx('2026-08-01', 'MONTHLY MAINTENANCE FEE', -12))).toBe('fee');
    expect(matchFeeLabel(tx('2026-08-01', 'OVERDRAFT ITEM', -36))).toBe('overdraft');
    expect(matchFeeLabel(tx('2026-08-01', 'NSF RETURN', -30))).toBe('insufficient funds');
    expect(matchFeeLabel(tx('2026-08-01', 'ATM WITHDRAWAL', -3))).toBe('ATM');
    expect(matchFeeLabel(tx('2026-08-01', 'INTEREST CHARGED ON PURCHASES', -18))).toBe('interest charge');
  });

  it('does not flag COFFEE, which a bare /fee/ would', () => {
    expect(matchFeeLabel(tx('2026-08-01', 'BLUE COFFEE CO', -4.5))).toBeNull();
    expect(matchFeeLabel(tx('2026-08-01', 'Coffee Shop', -4.5))).toBeNull();
    expect(matchFeeLabel(tx('2026-08-01', 'TOFFEE HOUSE', -9))).toBeNull();
  });

  it('reads the notes field too, where the raw statement line lives', () => {
    expect(matchFeeLabel(tx('2026-08-01', 'Huntington', -35, 'Other', 'OVERDRAFT FEE'))).toBe('fee');
  });

  it('returns null for ordinary vendors', () => {
    expect(matchFeeLabel(tx('2026-08-01', 'Shell Oil', -40))).toBeNull();
  });
});

describe('findFeeWaste', () => {
  it('totals fees and annualizes over the months analyzed', () => {
    const [f] = findFeeWaste(
      [tx('2026-07-01', 'MAINTENANCE FEE', -10), tx('2026-08-01', 'OVERDRAFT FEE', -35), tx('2026-08-02', 'Shell', -40)],
      2,
    );
    expect(f.kind).toBe('fee');
    expect(f.annualImpact).toBe(270); // (45 / 2 months) * 12
    expect(f.evidence).toHaveLength(2);
    expect(f.evidence[0].amount).toBe(-35); // biggest first
  });

  it('ignores income that happens to mention interest', () => {
    expect(findFeeWaste([tx('2026-08-01', 'Interest Payment', 0.01)], 1)).toHaveLength(0);
  });

  it('reports nothing when there are no fees', () => {
    expect(findFeeWaste([tx('2026-08-01', 'Shell', -40)], 3)).toHaveLength(0);
  });
});

describe('findPriceCreep', () => {
  const monthly = (vendor: string, amounts: number[]) =>
    amounts.map((a, i) => tx(`2026-0${i + 1}-15`, vendor, -a, 'Subscriptions'));

  it('catches a subscription whose price climbed', () => {
    const [f] = findPriceCreep(monthly('Netflix', [15.99, 15.99, 19.99, 22.99, 22.99, 22.99]));
    expect(f.kind).toBe('price-creep');
    expect(f.title).toContain('Netflix');
    expect(f.annualImpact).toBeGreaterThan(70);
  });

  it('ignores a stable price', () => {
    expect(findPriceCreep(monthly('Netflix', [15.99, 15.99, 15.99, 15.99, 15.99, 15.99]))).toHaveLength(0);
  });

  it('ignores a price that fell', () => {
    expect(findPriceCreep(monthly('Netflix', [22.99, 22.99, 19.99, 15.99, 15.99, 15.99]))).toHaveLength(0);
  });

  it('needs enough charges to call it a trend', () => {
    expect(findPriceCreep(monthly('Netflix', [10, 20]))).toHaveLength(0);
  });

  it('ignores a jump inside too short a window', () => {
    const sameWeek = [
      tx('2026-03-01', 'Netflix', -10, 'Subscriptions'),
      tx('2026-03-02', 'Netflix', -10, 'Subscriptions'),
      tx('2026-03-03', 'Netflix', -30, 'Subscriptions'),
      tx('2026-03-04', 'Netflix', -30, 'Subscriptions'),
    ];
    expect(findPriceCreep(sameWeek)).toHaveLength(0);
  });

  it('groups vendors through the normalizer, so store codes do not split them', () => {
    const rows = [
      tx('2026-01-15', 'SHELL OIL 12345678', -30, 'Transport'),
      tx('2026-02-15', 'Shell Oil', -30, 'Transport'),
      tx('2026-03-15', 'SHELL OIL 99887766', -45, 'Transport'),
      tx('2026-04-15', 'Shell Oil', -45, 'Transport'),
    ];
    expect(findPriceCreep(rows)).toHaveLength(1);
  });

  it('ignores income', () => {
    const rows = [1, 2, 3, 4].map((i) => tx(`2026-0${i}-15`, 'Payroll', 1000 + i * 500));
    expect(findPriceCreep(rows)).toHaveLength(0);
  });
});

describe('findSubscriptionWaste', () => {
  it('restates a small monthly charge as its annual cost', () => {
    const [f] = findSubscriptionWaste(
      [{ vendor: 'Apple', averageAmount: 10.59, frequency: 'monthly', occurrences: 6 }],
      [tx('2026-07-04', 'Apple', -10.59, 'Subscriptions')],
    );
    expect(f.annualImpact).toBe(127.08);
    expect(f.title).toContain('Apple');
  });

  it('annualizes weekly charges at 52', () => {
    const [f] = findSubscriptionWaste(
      [{ vendor: 'Coffee Club', averageAmount: 5, frequency: 'weekly', occurrences: 10 }],
      [],
    );
    expect(f.annualImpact).toBe(260);
  });

  it('sorts the most expensive first', () => {
    const out = findSubscriptionWaste(
      [
        { vendor: 'Small', averageAmount: 3, frequency: 'monthly', occurrences: 5 },
        { vendor: 'Big', averageAmount: 50, frequency: 'monthly', occurrences: 5 },
      ],
      [],
    );
    expect(out[0].title).toContain('Big');
  });

  it('reports nothing with no subscriptions', () => {
    expect(findSubscriptionWaste([], [])).toHaveLength(0);
  });
});

describe('findCategoryDrift', () => {
  const spend = (month: string, cat: string, amounts: number[]) =>
    amounts.map((a, i) => tx(`${month}-0${i + 1}`, `Vendor ${i}`, -a, cat));

  it('flags a category well above its own median', () => {
    const rows = [
      ...spend('2026-02', 'Food & Dining', [100]),
      ...spend('2026-03', 'Food & Dining', [100]),
      ...spend('2026-04', 'Food & Dining', [100]),
      ...spend('2026-05', 'Food & Dining', [100]),
      ...spend('2026-06', 'Food & Dining', [100]),
      ...spend('2026-07', 'Food & Dining', [400]), // latest complete month
    ];
    const [f] = findCategoryDrift(rows, NOW);
    expect(f.kind).toBe('category-drift');
    expect(f.title).toContain('Food & Dining');
    expect(f.annualImpact).toBe(3600); // 300 over, monthly
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('is not fooled by one earlier blowout month, because it uses the median', () => {
    const rows = [
      ...spend('2026-03', 'Shopping', [100]),
      ...spend('2026-04', 'Shopping', [100]),
      ...spend('2026-05', 'Shopping', [5000]), // an outlier that a mean would absorb
      ...spend('2026-06', 'Shopping', [100]),
      ...spend('2026-07', 'Shopping', [400]),
    ];
    const [f] = findCategoryDrift(rows, NOW);
    expect(f).toBeDefined();
    expect(f.title).toContain('Shopping');
  });

  it('ignores a normal month', () => {
    const rows = [
      ...spend('2026-04', 'Transport', [100]),
      ...spend('2026-05', 'Transport', [110]),
      ...spend('2026-06', 'Transport', [95]),
      ...spend('2026-07', 'Transport', [105]),
    ];
    expect(findCategoryDrift(rows, NOW)).toHaveLength(0);
  });

  it('ignores a small absolute increase even when the percentage is large', () => {
    const rows = [
      ...spend('2026-04', 'Personal Care', [5]),
      ...spend('2026-05', 'Personal Care', [5]),
      ...spend('2026-06', 'Personal Care', [5]),
      ...spend('2026-07', 'Personal Care', [20]), // +300% but only $15
    ];
    expect(findCategoryDrift(rows, NOW)).toHaveLength(0);
  });

  it('needs at least two prior months to have a normal', () => {
    const rows = [...spend('2026-06', 'Shopping', [100]), ...spend('2026-07', 'Shopping', [900])];
    expect(findCategoryDrift(rows, NOW)).toHaveLength(0);
  });

  it('ignores income', () => {
    const rows = [
      tx('2026-05-01', 'Payroll', 1000, 'Other'),
      tx('2026-06-01', 'Payroll', 1000, 'Other'),
      tx('2026-07-01', 'Payroll', 9000, 'Other'),
    ];
    expect(findCategoryDrift(rows, NOW)).toHaveLength(0);
  });
});

describe('medianOf', () => {
  it('handles odd and even counts', () => {
    expect(medianOf([1, 3, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns 0 for nothing', () => {
    expect(medianOf([])).toBe(0);
  });
});
