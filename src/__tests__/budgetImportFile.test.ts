import { looksLikePdf, isDamagedPdfError, describePdfFailure } from '../lib/budgetImportFile';

describe('looksLikePdf', () => {
  it('accepts a normal PDF header', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n11 0 obj'))).toBe(true);
  });

  it('accepts a header preceded by junk, as the spec allows', () => {
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(300, 0x20), Buffer.from('%PDF-1.7')]))).toBe(true);
  });

  it('rejects a header pushed past the first 1024 bytes', () => {
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from('%PDF-1.7')]))).toBe(false);
  });

  it('rejects CSV and other text', () => {
    expect(looksLikePdf(Buffer.from('Date,Vendor,Amount\n2026-08-01,Shell,-40'))).toBe(false);
    expect(looksLikePdf(Buffer.from(''))).toBe(false);
  });

  it('rejects binary that is not a PDF', () => {
    expect(looksLikePdf(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false); // zip/xlsx
  });

  it('does not choke on high bytes that are invalid UTF-8', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe, 0x80, 0x81]), Buffer.from('%PDF-1.4')]);
    expect(looksLikePdf(buf)).toBe(true);
  });
});

describe('isDamagedPdfError', () => {
  it('recognizes the structural failures pdf.js reports', () => {
    // The message DeJon actually saw.
    expect(isDamagedPdfError('bad XRef entry')).toBe(true);
    expect(isDamagedPdfError('bad XRef entry for compressed object')).toBe(true);
    expect(isDamagedPdfError('Invalid PDF structure')).toBe(true);
    expect(isDamagedPdfError('Unknown block type in flate stream')).toBe(true);
    expect(isDamagedPdfError('Invalid startxref')).toBe(true);
  });

  it('does not claim damage for unrelated errors', () => {
    expect(isDamagedPdfError('No text layer found')).toBe(false);
    expect(isDamagedPdfError('Password required')).toBe(false);
  });
});

describe('describePdfFailure', () => {
  it('explains a damaged file and names it', () => {
    const { error, detail } = describePdfFailure('statement.pdf', 'bad XRef entry');
    expect(error).toContain('statement.pdf');
    expect(error).toContain('damaged');
    expect(error).toContain('Re-download');
    expect(detail).toBe('bad XRef entry');
  });

  it('falls back to a generic message but keeps the detail', () => {
    const { error, detail } = describePdfFailure('statement.pdf', 'Password required');
    expect(error).toContain('statement.pdf');
    expect(detail).toBe('Password required');
  });

  it('never leaks the raw library wording into the headline', () => {
    const { error } = describePdfFailure('s.pdf', 'bad XRef entry');
    expect(error).not.toContain('XRef');
  });
});
