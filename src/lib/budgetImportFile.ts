// Pure helpers for deciding what an uploaded statement actually is, and for
// turning pdf.js's internal error strings into something a person can act on.
// No pdf-parse import here so this stays unit-testable.

/** PDF spec puts the %PDF- header in the first 1024 bytes. Sniffing the bytes
 *  beats trusting `file.type`, which browsers and share sheets get wrong. */
export function looksLikePdf(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

/** pdf.js raises these when a file's cross-reference table is damaged, which
 *  is what a partial download or a re-saved/edited PDF usually produces. */
const DAMAGED_PDF_SIGNALS = [
  'xref',
  'invalid pdf structure',
  'flate stream',
  'startxref',
  'missing catalog',
  'invalid root reference',
];

export function isDamagedPdfError(message: string): boolean {
  const m = message.toLowerCase();
  return DAMAGED_PDF_SIGNALS.some((s) => m.includes(s));
}

/** Message shown to the user. Keeps the library's own words in `detail` so a
 *  bug report still carries the diagnostic. */
export function describePdfFailure(filename: string, message: string): { error: string; detail: string } {
  const detail = message;
  if (isDamagedPdfError(message)) {
    return {
      error:
        `Couldn't read "${filename}" — the PDF's internal structure is damaged, which usually means ` +
        `the download was interrupted or the file was re-saved by another app. Re-download the ` +
        `statement from your bank and upload the original, or export it as CSV.`,
      detail,
    };
  }
  return {
    error: `Couldn't read "${filename}" as a PDF. Try re-downloading it, or export the statement as CSV.`,
    detail,
  };
}
