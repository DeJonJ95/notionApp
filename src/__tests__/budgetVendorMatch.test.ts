import { normalizeVendor, vendorsMatch } from '../lib/budgetDb';

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
