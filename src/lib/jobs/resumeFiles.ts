// Resume file handling for both .docx and .pdf uploads. Parsing produces the
// plain text the AI match/recruiter steps consume. Note: tailoring (surgical
// in-place editing) is .docx-only — a PDF has no clean text-run model to edit
// without reflowing, so PDF resumes are upload/analyze-only (see the tailor
// route, which generates the recruiter message but no edited file for PDFs).

import { parseDocx } from './docx';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';

export type ResumeFileType = 'docx' | 'pdf';

export function detectResumeType(name: string, mime: string): ResumeFileType | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mime === PDF_MIME) return 'pdf';
  if (n.endsWith('.docx') || mime === DOCX_MIME) return 'docx';
  return null;
}

export function mimeFor(type: ResumeFileType): string {
  return type === 'pdf' ? PDF_MIME : DOCX_MIME;
}

// pdf-parse's index.js loads a test PDF on import — import the implementation
// file directly to bypass it (same workaround as the budget import route).
export async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = (await import('pdf-parse/lib/pdf-parse.js' as any)) as any;
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return (result.text || '').trim();
}

export async function parseResumeFile(buffer: Buffer, type: ResumeFileType): Promise<string> {
  return type === 'pdf' ? parsePdf(buffer) : parseDocx(buffer);
}
