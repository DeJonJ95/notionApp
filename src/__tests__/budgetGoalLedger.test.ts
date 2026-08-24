import { goalLedgerAmounts } from '../lib/budgetDb';

const goals = [
  { id: 'g1', name: 'Emergency Fund' },
  { id: 'g2', name: 'Japan Trip' },
];

describe('goalLedgerAmounts', () => {
  it('sums transactions naming the goal', () => {
    const out = goalLedgerAmounts(goals, [
      { text: 'Transfer to Emergency Fund ', amount: 200 },
      { text: 'emergency fund top-up', amount: 150 },
      { text: 'Japan Trip flights', amount: 500 },
    ]);
    expect(out).toEqual({ g1: 350, g2: 500 });
  });

  it('ignores casing and punctuation', () => {
    const out = goalLedgerAmounts(goals, [{ text: 'EMERGENCY-FUND!!!', amount: 75 }]);
    expect(out.g1).toBe(75);
  });

  it('reports 0 for a goal with no matching transactions', () => {
    const out = goalLedgerAmounts(goals, [{ text: 'Groceries', amount: 40 }]);
    expect(out).toEqual({ g1: 0, g2: 0 });
  });

  it('lets a negative row act as a withdrawal', () => {
    const out = goalLedgerAmounts(goals, [
      { text: 'Emergency Fund deposit', amount: 500 },
      { text: 'Emergency Fund withdrawal', amount: -200 },
    ]);
    expect(out.g1).toBe(300);
  });

  it('does not credit one goal from another goal’s transaction', () => {
    const out = goalLedgerAmounts(goals, [{ text: 'Japan Trip hotel', amount: 300 }]);
    expect(out.g1).toBe(0);
    expect(out.g2).toBe(300);
  });

  it('ignores goal names too short to match on', () => {
    const out = goalLedgerAmounts([{ id: 'g3', name: 'AC' }], [{ text: 'AC unit fund', amount: 100 }]);
    expect(out.g3).toBe(0);
  });

  it('handles no goals and no transactions', () => {
    expect(goalLedgerAmounts([], [{ text: 'anything', amount: 10 }])).toEqual({});
    expect(goalLedgerAmounts(goals, [])).toEqual({ g1: 0, g2: 0 });
  });

  it('skips transactions whose text normalizes to nothing', () => {
    const out = goalLedgerAmounts(goals, [{ text: '***', amount: 100 }]);
    expect(out.g1).toBe(0);
  });

  it('rounds to cents', () => {
    const out = goalLedgerAmounts(goals, [
      { text: 'Emergency Fund', amount: 0.1 },
      { text: 'Emergency Fund', amount: 0.2 },
    ]);
    expect(out.g1).toBe(0.3);
  });
});
