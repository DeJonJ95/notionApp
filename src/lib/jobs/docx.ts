// DOCX read + surgical tailoring.
//
// Parsing: mammoth extracts clean plain text, which is all the AI match step
// needs. Tailoring: we edit word/document.xml in place with pizzip rather
// than regenerating the document, so the original styling/layout survives.
// Edits are paragraph-scoped run-text swaps — minimal and reversible — which
// keeps the output ATS-parseable and the changes honest.

import mammoth from 'mammoth';
import PizZip from 'pizzip';

export async function parseDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

export type Tweak = { original: string; rewrite: string };

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Decode the handful of XML entities that appear in <w:t> text so our
// normalized comparison matches what the AI saw (mammoth-decoded) text.
function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const WT_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const WP_RE = /<w:p\b[\s\S]*?<\/w:p>/g;

// Replace every <w:t> in a single paragraph: the full rewrite goes into the
// first run (preserving its run properties), the rest are emptied. Good
// enough for resume bullets, where a paragraph is one logical line.
function rewriteParagraph(paragraph: string, rewrite: string): string {
  let first = true;
  return paragraph.replace(WT_RE, (match, _inner, offset, full) => {
    // Re-open the same <w:t ...> tag but force xml:space="preserve" so
    // leading/trailing spaces in the rewrite aren't collapsed by Word.
    const openTagMatch = match.match(/^<w:t\b[^>]*>/);
    let openTag = openTagMatch ? openTagMatch[0] : '<w:t>';
    if (!/xml:space=/.test(openTag)) {
      openTag = openTag.replace(/>$/, ' xml:space="preserve">');
    }
    if (first) {
      first = false;
      return `${openTag}${escapeXml(rewrite)}</w:t>`;
    }
    return `${openTag}</w:t>`;
  });
}

/**
 * Apply approved tweaks to a .docx, returning the new file bytes.
 *
 * For each tweak we find the paragraph whose concatenated run text matches
 * the tweak's `original` (whitespace/case-insensitive) and replace it with
 * `rewrite`. Tweaks whose original can't be located are reported in
 * `unmatched` so the caller can surface them rather than silently dropping
 * an intended change.
 */
export function tailorDocx(
  buffer: Buffer,
  tweaks: Tweak[],
): { bytes: Buffer; applied: number; unmatched: Tweak[] } {
  const zip = new PizZip(buffer);
  const docPath = 'word/document.xml';
  const xml = zip.file(docPath)?.asText();
  if (!xml) throw new Error('document.xml not found in .docx');

  const wanted = tweaks
    .filter((t) => t.original?.trim() && t.rewrite?.trim())
    .map((t) => ({ ...t, key: normalize(t.original) }));
  const remaining = new Map(wanted.map((t) => [t.key, t]));

  let applied = 0;
  const newXml = xml.replace(WP_RE, (paragraph) => {
    if (remaining.size === 0) return paragraph;
    // Concatenate this paragraph's run text to compare against originals.
    let text = '';
    let m: RegExpExecArray | null;
    WT_RE.lastIndex = 0;
    while ((m = WT_RE.exec(paragraph)) !== null) text += decodeXml(m[1]);
    const key = normalize(text);
    if (!key) return paragraph;
    const tweak = remaining.get(key);
    if (!tweak) return paragraph;
    remaining.delete(key);
    applied++;
    return rewriteParagraph(paragraph, tweak.rewrite);
  });

  zip.file(docPath, newXml);
  const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { bytes, applied, unmatched: Array.from(remaining.values()) };
}
