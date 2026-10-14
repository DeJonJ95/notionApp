// DOCX read + surgical tailoring. Tailoring edits word/document.xml in place
// with pizzip rather than regenerating the file, so the user's styling
// survives. Each tweak replaces only the span of text it quotes; runs before
// and after it keep their own formatting.

import mammoth from 'mammoth';
import PizZip from 'pizzip';
import { tweakSpan } from './textMatch';
import { escapeXml, decodeXml } from './xmlText';

export async function parseDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

export type Tweak = { original: string; rewrite: string };

const WT_RE = /(<w:t\b[^>]*?)(?:\/>|>([\s\S]*?)<\/w:t>)/g;
// Innermost paragraphs only: a text box nests whole paragraphs inside a run.
const WP_RE = /<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;

type Run = { open: string; text: string; start: number; end: number };

function runsOf(paragraph: string): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const m of paragraph.matchAll(WT_RE)) {
    const text = decodeXml(m[2] ?? '');
    runs.push({ open: m[1], text, start: at, end: at + text.length });
    at += text.length;
  }
  return runs;
}

function cut(run: Run, [a, b]: [number, number], rewrite: string, isFirst: boolean): string {
  const tail = b < run.end ? run.text.slice(b - run.start) : '';
  return isFirst ? run.text.slice(0, Math.max(0, a - run.start)) + rewrite + tail : tail;
}

// Swap [a, b) of the paragraph's text for `rewrite`. The first run touched
// carries the rewrite in its own formatting; later touched runs keep only
// their text past b, and untouched runs are left byte-for-byte alone.
function splice(paragraph: string, span: [number, number], rewrite: string): string {
  const runs = runsOf(paragraph);
  const touched = runs.filter((r) => r.start < span[1] && r.end > span[0]);
  if (!touched.length) return paragraph;
  let i = -1;
  return paragraph.replace(WT_RE, (whole) => {
    const run = runs[++i];
    if (!touched.includes(run)) return whole;
    const open = /xml:space=/.test(run.open) ? run.open : `${run.open} xml:space="preserve"`;
    return `${open}>${escapeXml(cut(run, span, rewrite, run === touched[0]))}</w:t>`;
  });
}

/** Apply tweaks to WordprocessingML, returning the new XML and which tweaks landed. */
export function tailorXml(xml: string, tweaks: Tweak[]): { xml: string; hit: Set<Tweak> } {
  const landed = new Map<Tweak, string>();
  const out = xml.replace(WP_RE, (paragraph) => {
    let current = paragraph;
    for (const tweak of tweaks) {
      const text = runsOf(current).map((r) => r.text).join('');
      const first = landed.get(tweak);
      if (!text || (first !== undefined && first !== text)) continue;
      const span = tweakSpan(text, tweak.original, tweak.rewrite);
      if (!span) continue;
      current = splice(current, span, tweak.rewrite.trim());
      landed.set(tweak, text);
    }
    return current;
  });
  return { xml: out, hit: new Set(landed.keys()) };
}

// A tweak rewrites the first paragraph holding its original, plus identical copies
// (Word's duplicate of text-box content). Unlocated tweaks come back in `unmatched`.
export function tailorDocx(
  buffer: Buffer,
  tweaks: Tweak[],
): { bytes: Buffer; applied: number; unmatched: Tweak[] } {
  const zip = new PizZip(buffer);
  const docPath = 'word/document.xml';
  const xml = zip.file(docPath)?.asText();
  if (!xml) throw new Error('document.xml not found in .docx');

  const wanted = tweaks.filter((t) => t.original?.trim() && t.rewrite?.trim());
  const { xml: newXml, hit } = tailorXml(xml, wanted);
  zip.file(docPath, newXml);
  const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { bytes, applied: hit.size, unmatched: wanted.filter((t) => !hit.has(t)) };
}
