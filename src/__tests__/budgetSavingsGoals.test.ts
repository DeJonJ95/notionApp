import { monthsUntil, monthlySavingsContribution } from '../lib/budgetDb';

const NOW = new Date(2026, 7, 24); // Aug 24 2026
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('monthsUntil', () => {
  it('counts a partial month as one', () => {
    expect(monthsUntil(at(2026, 9, 1), NOW)).toBe(1);
    expect(monthsUntil(at(2026, 8, 31), NOW)).toBe(1);
  });

  it('counts exact calendar months without overshooting', () => {
    expect(monthsUntil(at(2026, 10, 24), NOW)).toBe(2);
    expect(monthsUntil(at(2027, 8, 24), NOW)).toBe(12);
  });

  it('rounds a part-month up', () => {
    expect(monthsUntil(at(2026, 9, 30), NOW)).toBe(2);
    expect(monthsUntil(at(2026, 10, 25), NOW)).toBe(3);
  });

  it('never returns less than 1, even for a past deadline', () => {
    expect(monthsUntil(at(2026, 1, 1), NOW)).toBe(1);
    expect(monthsUntil(NOW, NOW)).toBe(1);
  });
});

describe('monthlySavingsContribution', () => {
  it('spreads the remaining amount over the months left', () => {
    const total = monthlySavingsContribution(
      [{ targetAmount: 1200, currentAmount: 0, deadline: at(2027, 8, 24) }],
      NOW,
    );
    expect(total).toBe(100); // 1200 over 12 months
  });

  it('counts only what is still unfunded', () => {
    const total = monthlySavingsContribution(
      [{ targetAmount: 1200, currentAmount: 600, deadline: at(2027, 8, 24) }],
      NOW,
    );
    expect(total).toBe(50);
  });

  it('spreads a deadline-less goal over a year', () => {
    expect(monthlySavingsContribution([{ targetAmount: 2400, currentAmount: 0, deadline: null }], NOW)).toBe(200);
  });

  it('charges nothing for an already-funded goal', () => {
    expect(
      monthlySavingsContribution([{ targetAmount: 500, currentAmount: 500, deadline: null }], NOW),
    ).toBe(0);
    expect(
      monthlySavingsContribution([{ targetAmount: 500, currentAmount: 900, deadline: null }], NOW),
    ).toBe(0);
  });

  it('demands the whole remainder when the deadline has passed', () => {
    const total = monthlySavingsContribution(
      [{ targetAmount: 1000, currentAmount: 250, deadline: at(2026, 1, 1) }],
      NOW,
    );
    expect(total).toBe(750);
  });

  it('sums several goals', () => {
    const total = monthlySavingsContribution(
      [
        { targetAmount: 1200, currentAmount: 0, deadline: at(2027, 8, 24) },   // 100/mo
        { targetAmount: 2400, currentAmount: 0, deadline: null },              // 200/mo
        { targetAmount: 300, currentAmount: 300, deadline: null },             // funded
      ],
      NOW,
    );
    expect(total).toBe(300);
  });

  it('returns 0 with no goals', () => {
    expect(monthlySavingsContribution([], NOW)).toBe(0);
  });

  it('no longer treats a goal total as a monthly cost', () => {
    // The old math summed targetAmount, so this would have been 10000.
    const total = monthlySavingsContribution(
      [{ targetAmount: 10000, currentAmount: 0, deadline: null }],
      NOW,
    );
    expect(total).toBeLessThan(1000);
  });
});
