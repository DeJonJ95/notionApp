import { normalizeVendor, vendorsMatch, vendorsSimilar } from '../lib/budgetDb';

describe('normalizeVendor', () => {
  it('lowercases and trims', () => {
    expect(normalizeVendor('  Netflix  ')).toBe('netflix');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(normalizeVendor('AMAZON  PRIME*JH5')).toBe('amazon prime jh5');
    expect(normalizeVendor("McDonald's #402")).toBe('mcdonald s');
  });

  it('drops store and reference numbers of 3+ digits', () => {
    expect(normalizeVendor('SHELL OIL 57444109801')).toBe('shell oil');
    expect(normalizeVendor('Chase 1234')).toBe('chase');
  });

  it('keeps short numbers that are part of the name', () => {
    expect(normalizeVendor('7 Eleven')).toBe('7 eleven');
  });

  it('drops legal-suffix noise words', () => {
    expect(normalizeVendor('Acme Widgets, Inc.')).toBe('acme widgets');
    expect(normalizeVendor('The Home Depot LLC')).toBe('home depot');
  });

  it('handles empty and junk input', () => {
    expect(normalizeVendor('')).toBe('');
    expect(normalizeVendor('   ')).toBe('');
    expect(normalizeVendor('***')).toBe('');
    expect(normalizeVendor(undefined as any)).toBe('');
  });

  it('collapses two spellings of the same merchant to the same string', () => {
    expect(normalizeVendor('Amazon Prime, Inc.')).toBe(normalizeVendor('AMAZON PRIME'));
  });
});

describe('vendorsMatch', () => {
  it('matches identical names regardless of casing and punctuation', () => {
    expect(vendorsMatch('Netflix', 'NETFLIX.COM')).toBe(true);
    expect(vendorsMatch('Amazon Prime, Inc.', 'AMAZON PRIME')).toBe(true);
  });

  it('matches when one normalized name contains the other', () => {
    expect(vendorsMatch('Netflix', 'Netflix Monthly Subscription')).toBe(true);
    expect(vendorsMatch('SHELL OIL 57444109801', 'Shell Oil')).toBe(true);
  });

  it('does not match unrelated vendors', () => {
    expect(vendorsMatch('Netflix', 'Spotify')).toBe(false);
    expect(vendorsMatch('Random Store', 'City of Detroit Paycheck')).toBe(false);
  });

  it('refuses to match on a fragment shorter than 4 characters', () => {
    // "cvs" is inside "cvs pharmacy", but a 3-char fragment is too weak to
    // trust — it would sweep in anything that happens to contain it.
    expect(vendorsMatch('CVS', 'CVS Pharmacy')).toBe(false);
    expect(vendorsMatch('BP', 'BP Gas Station')).toBe(false);
  });

  it('still matches a 3-char vendor against itself', () => {
    expect(vendorsMatch('CVS', 'cvs')).toBe(true);
  });

  it('never matches when either side normalizes to nothing', () => {
    expect(vendorsMatch('', 'Netflix')).toBe(false);
    expect(vendorsMatch('***', 'Netflix')).toBe(false);
    expect(vendorsMatch('', '')).toBe(false);
  });

  it('is symmetric', () => {
    expect(vendorsMatch('Netflix Monthly', 'Netflix')).toBe(vendorsMatch('Netflix', 'Netflix Monthly'));
    expect(vendorsMatch('Shell', 'Spotify')).toBe(vendorsMatch('Spotify', 'Shell'));
  });
});

// Looser matcher used only where a RECURRING RULE's name has to line up with a
// bank's own wording. Never used for cross-import dedup.
describe('vendorsSimilar', () => {
  it('matches a rule name against the statement wording that defeated containment', () => {
    // The reported failure: reconciliation reported the paycheck missing.
    expect(vendorsMatch('City of Detroit Paycheck', 'CITY OF DETROIT PAYROLL 2606231026')).toBe(false);
    expect(vendorsSimilar('City of Detroit Paycheck', 'CITY OF DETROIT PAYROLL 2606231026')).toBe(true);
  });

  it('still accepts everything the strict matcher accepts', () => {
    expect(vendorsSimilar('Netflix', 'NETFLIX.COM')).toBe(true);
    expect(vendorsSimilar('Shell Oil', 'SHELL OIL 57444109801')).toBe(true);
    expect(vendorsSimilar('DTE Energy', 'DTE ENERGY BILL PAYMT 887766')).toBe(true);
  });

  it('rejects unrelated vendors', () => {
    expect(vendorsSimilar('Netflix', 'Spotify')).toBe(false);
    expect(vendorsSimilar('Huntington', 'Interest Payment')).toBe(false);
    expect(vendorsSimilar('Random Store', 'City of Detroit Paycheck')).toBe(false);
  });

  it('needs two shared identifying words, not one', () => {
    // A single shared word is far too weak — these are different utilities.
    expect(vendorsSimilar('Detroit Water', 'Detroit Edison')).toBe(false);
    expect(vendorsSimilar('First Bank', 'First Insurance')).toBe(false);
  });

  it('does not count connector words toward the overlap', () => {
    // Shares only "of" and "the" once connectors are discounted.
    expect(vendorsSimilar('Bank of America', 'City of Detroit')).toBe(false);
  });

  it('needs at least two words on each side for the overlap fallback', () => {
    // One-word names carry too little signal to score. (A one-word name that
    // is literally contained in the other still matches via the strict path,
    // e.g. "Detroit" inside "Detroit Water Board".)
    expect(vendorsSimilar('Payroll', 'City of Detroit Paycheck')).toBe(false);
    expect(vendorsSimilar('Detroit', 'Detroit Water Board')).toBe(true); // strict containment
  });

  it('is symmetric', () => {
    const a = 'City of Detroit Paycheck';
    const b = 'CITY OF DETROIT PAYROLL 2606231026';
    expect(vendorsSimilar(a, b)).toBe(vendorsSimilar(b, a));
  });

  it('handles empty input', () => {
    expect(vendorsSimilar('', 'City of Detroit Paycheck')).toBe(false);
    expect(vendorsSimilar('***', '###')).toBe(false);
  });

  it('leans permissive on same-payer names — the amount check is the discriminator', () => {
    // Documented trade-off: callers pair this with an amount match within 30%,
    // which is what keeps a paycheck rule off a water bill.
    expect(vendorsSimilar('City of Detroit Paycheck', 'City of Detroit Water')).toBe(true);
  });
});
