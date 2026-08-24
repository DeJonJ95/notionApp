import {
  recurringNote,
  isRecurringGeneratedNote,
  isDateCovered,
  findDuplicateTransactions,
  vendorsMatch,
} from '../lib/budgetDb';

const range = (from: string, to: string) => ({
  dateFrom: new Date(from + 'T00:00:00'),
  dateTo: new Date(to + 'T00:00:00'),
});

describe('recurringNote / isRecurringGeneratedNote', () => {
  it('round-trips the marker the engine writes', () => {
    expect(isRecurringGeneratedNote(recurringNote('income', 'City of Detroit Paycheck'))).toBe(true);
    expect(isRecurringGeneratedNote(recurringNote('expense', 'Rent'))).toBe(true);
  });

  it('does not claim rows the user or an import created', () => {
    expect(isRecurringGeneratedNote('CITY OF DETROIT PAYROLL 26062310')).toBe(false);
    expect(isRecurringGeneratedNote('Recurring donation to the food bank')).toBe(false);
    expect(isRecurringGeneratedNote('')).toBe(false);
    expect(isRecurringGeneratedNote(null)).toBe(false);
    expect(isRecurringGeneratedNote(undefined)).toBe(false);
  });
});

describe('isDateCovered', () => {
  const imports = [range('2026-06-24', '2026-07-10'), range('2026-05-01', '2026-05-31')];

  it('covers the range inclusively at both ends', () => {
    expect(isDateCovered('2026-06-24', imports)).toBe(true);
    expect(isDateCovered('2026-07-10', imports)).toBe(true);
    expect(isDateCovered('2026-06-26', imports)).toBe(true);
  });

  it('leaves dates outside every range uncovered', () => {
    expect(isDateCovered('2026-06-23', imports)).toBe(false);
    expect(isDateCovered('2026-07-11', imports)).toBe(false);
    expect(isDateCovered('2026-06-15', imports)).toBe(false); // gap between the two
  });

  it('reports nothing covered when there are no imports', () => {
    expect(isDateCovered('2026-06-26', [])).toBe(false);
  });
});

// The reported bug: a recurring paycheck and the imported real paycheck both
// counted. Dedup can't catch it, which is why coverage-skipping exists.
describe('the recurring/import collision dedup cannot catch', () => {
  const generated = { date: '2026-06-26', vendor: 'City of Detroit Paycheck', amount: 1759.44 };
  const imported = {
    date: '2026-06-26',
    vendor: 'CITY OF DETROIT PAYROLL 2606231026',
    description: '',
    amount: 2082.44,
    category: 'Other',
  };

  it('cannot match the rule name against the statement wording', () => {
    // "Paycheck" vs "Payroll" — no containment either way.
    expect(vendorsMatch(generated.vendor, imported.vendor)).toBe(false);
  });

  it('finds no duplicate, even when the amounts happen to agree', () => {
    expect(findDuplicateTransactions([generated], [imported])).toHaveLength(0);
    expect(
      findDuplicateTransactions([{ ...generated, amount: 2082.44 }], [imported]),
    ).toHaveLength(0);
  });

  it('is instead prevented by the import range covering the due date', () => {
    const july = [range('2026-06-24', '2026-07-10')];
    expect(isDateCovered(generated.date, july)).toBe(true);
  });

  it('applies to bills exactly as it does to paychecks', () => {
    const bill = { date: '2026-07-01', vendor: 'DTE Energy', amount: 120 };
    const realCharge = {
      date: '2026-07-01',
      vendor: 'DTE ENERGY BILL PAYMT 887766',
      description: '',
      amount: -143.87,
      category: 'Utilities',
    };
    // Variable amount defeats dedup even though the vendor does match here.
    expect(vendorsMatch(bill.vendor, realCharge.vendor)).toBe(true);
    expect(findDuplicateTransactions([bill], [realCharge])).toHaveLength(0);
    expect(isDateCovered(bill.date, [range('2026-06-24', '2026-07-10')])).toBe(true);
  });
});
