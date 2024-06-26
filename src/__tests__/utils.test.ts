import { getPositionBetween, evaluateFormula, computeFormulaValues } from '../lib/utils';

describe('getPositionBetween', () => {
  it('returns 1024 when both bounds are null', () => {
    expect(getPositionBetween(null, null)).toBe(1024);
  });

  it('returns half of next when prev is null', () => {
    expect(getPositionBetween(null, 512)).toBe(256);
  });

  it('returns prev + 1024 when next is null', () => {
    expect(getPositionBetween(100, null)).toBe(1124);
  });

  it('returns the midpoint between prev and next', () => {
    expect(getPositionBetween(100, 200)).toBe(150);
  });
});

describe('evaluateFormula', () => {
  it('evaluates a simple arithmetic expression', () => {
    expect(evaluateFormula('Price * Quantity', { Price: 10, Quantity: 3 })).toBe(30);
  });

  it('returns empty string for an empty formula', () => {
    expect(evaluateFormula('', {})).toBe('');
  });

  it('throws on disallowed characters (security guard)', () => {
    expect(() =>
      evaluateFormula('constructor.constructor("return process")()', {})
    ).toThrow();
  });
});

describe('computeFormulaValues', () => {
  it('computes formula properties and leaves others untouched', () => {
    const properties = [
      { id: 'p1', name: 'Price' },
      { id: 'p2', name: 'Qty' },
      { id: 'p3', name: 'Total', formula: 'Price * Qty' },
    ];
    const values = { Price: 5, Qty: 4 };
    const result = computeFormulaValues(properties, values);
    expect(result).toEqual({ p3: 20 });
  });

  it('returns "Formula error" string when evaluation fails', () => {
    const properties = [{ id: 'p1', name: 'Bad', formula: 'NonExistent + 1' }];
    const result = computeFormulaValues(properties, {});
    expect(result.p1).toBe('Formula error');
  });
});
