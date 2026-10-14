// Reads a .docx into reading-order text blocks, including the places a
// simple parser skips: text boxes, table cells and the page header. This is
// the source for the ATS-safe resume, so nothing the user wrote may go missing.

import PizZip from 'pizzip';

export type BlockKind = 'heading' | 'bullet' | 'para';
export type Block = { kind: BlockKind; text: string };

type Para = { text: string; list: boolean; style: string };
type Row = { cells: Para[][] };

const TOKEN = /(?<p><w:p\b[^>]*>)|(?<pEnd><\/w:p>)|<w:t\b[^>]*?(?:\/>|>(?<t>[\s\S]*?)<\/w:t>)|(?<tab><w:tab\/>)|(?<br><w:br\b[^>]*\/>)|(?<num><w:numPr>)|<w:pStyle w:val="(?<style>[^"]*)"|(?<tr><w:tr\b[^>]*>)|(?<trEnd><\/w:tr>)|(?<tc><w:tc\b[^>]*>)/g;

const SECTION_NAMES = /^(professional |work |relevant |technical |core |key )?(summary|profile|objective|experience|employment( history)?|work history|career history|education|skills|competencies|qualifications|projects|certifications?|licenses|awards|honors|publications|volunteer(ing| experience)?|leadership|languages|interests|activities|training|achievements|affiliations|references)( & [a-z ]+)?:?$/i;

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function isSectionHeading(text: string): boolean {
  const t = text.trim();
  if (SECTION_NAMES.test(t)) return true;
  return t.length <= 32 && /^[A-Z][A-Z &/]+:?$/.test(t) && t.split(/\s+/).length <= 4;
}

function toBlock(p: Para): Block | null {
  const text = p.text.replace(/\t+/g, ' | ').replace(/[  ]+/g, ' ').replace(/^[ |]+|[ |]+$/g, '').trim();
  if (!text) return null;
  if (/^(heading|title)/i.test(p.style) || isSectionHeading(text)) return { kind: 'heading', text };
  return { kind: p.list ? 'bullet' : 'para', text };
}

// A row whose cells each hold one line is a layout row ("Acme | 2020-2023"),
// so it reads as one line. Anything bigger (a sidebar column) reads cell by cell.
function flushRow(row: Row): Para[] {
  const filled = row.cells.map((c) => c.filter((p) => p.text.trim()));
  if (filled.every((c) => c.length <= 1) && filled.some((c) => c.length)) {
    const parts = filled.flat();
    return [{ text: parts.map((p) => p.text.trim()).join('\t'), list: parts[0].list, style: parts[0].style }];
  }
  return filled.flat();
}

type Walk = { paras: Para[]; open: Para[]; rows: Row[] };
type Step = (w: Walk, value: string) => void;

function emit(w: Walk, p: Para) {
  const row = w.rows[w.rows.length - 1];
  if (row) row.cells[row.cells.length - 1]?.push(p);
  else w.paras.push(p);
}

function onText(fn: (p: Para, value: string) => void): Step {
  return (w, value) => {
    const cur = w.open[w.open.length - 1];
    if (cur) fn(cur, value);
  };
}

const STEPS: Record<string, Step> = {
  p: (w, tag) => { if (!tag.endsWith('/>')) w.open.push({ text: '', list: false, style: '' }); },
  pEnd: (w) => { const p = w.open.pop(); if (p) emit(w, p); },
  t: onText((p, v) => { p.text += decode(v); }),
  tab: onText((p) => { p.text += '\t'; }),
  br: onText((p) => { p.text += ' '; }),
  num: onText((p) => { p.list = true; }),
  style: onText((p, v) => { p.style = v; }),
  tr: (w) => { w.rows.push({ cells: [] }); },
  trEnd: (w) => { const row = w.rows.pop(); if (row) flushRow(row).forEach((p) => emit(w, p)); },
  tc: (w) => { w.rows[w.rows.length - 1]?.cells.push([]); },
};

/** Paragraphs of one WordprocessingML part, in reading order. */
export function partBlocks(xml: string): Block[] {
  const walk: Walk = { paras: [], open: [], rows: [] };
  const clean = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
  for (const m of clean.matchAll(TOKEN)) {
    const hit = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined);
    if (hit) STEPS[hit[0]](walk, hit[1]);
  }
  return walk.paras.map(toBlock).filter((b): b is Block => !!b);
}

const CONTACT = /@|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|linkedin\.com|github\.com|https?:\/\//i;
const PAGE_NO = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i;

export function looksLikeName(b: Block | undefined): boolean {
  return !!b && b.kind === 'para' && b.text.length <= 40 && !/[@\d|]/.test(b.text);
}

function headerExtras(zip: PizZip, seen: Set<string>): Block[] {
  const extra: Block[] = [];
  zip.file(/^word\/(header|footer)\d*\.xml$/).forEach((f) => {
    const isHeader = f.name.includes('header');
    partBlocks(f.asText()).forEach((b) => {
      const key = b.text.toLowerCase();
      if (seen.has(key) || PAGE_NO.test(b.text)) return;
      if (!isHeader && !CONTACT.test(b.text)) return;
      seen.add(key);
      extra.push({ kind: 'para', text: b.text });
    });
  });
  return extra;
}

/**
 * The whole resume as blocks. Header text is moved into the body because
 * most ATS parsers never read the header, and the header is exactly where
 * resumes keep contact details. Contact lines land under the name; footers
 * contribute only contact lines.
 */
export function docxBlocks(buffer: Buffer): Block[] {
  const zip = new PizZip(buffer);
  const body = partBlocks(zip.file('word/document.xml')?.asText() ?? '');
  const extra = headerExtras(zip, new Set(body.map((b) => b.text.toLowerCase())));
  const contact = extra.filter((b) => CONTACT.test(b.text));
  const other = extra.filter((b) => !CONTACT.test(b.text));
  const [first, ...rest] = body;
  if (!other.length && looksLikeName(first)) return [first, ...contact, ...rest];
  return [...other, ...contact, ...body];
}

/** Blocks from plain text (a PDF's extracted lines), joining wrapped bullets. */
export function textBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || PAGE_NO.test(line)) continue;
    const bullet = /^[•●▪■◦‣∙·*\-–•]\s*/.exec(line);
    const prev = out[out.length - 1];
    if (bullet) out.push({ kind: 'bullet', text: line.slice(bullet[0].length) });
    else if (isSectionHeading(line)) out.push({ kind: 'heading', text: line });
    else if (prev?.kind === 'bullet' && /^[a-z(]/.test(line)) prev.text += ` ${line}`;
    else out.push({ kind: 'para', text: line });
  }
  return out;
}

export function blocksText(blocks: Block[]): string {
  return blocks.map((b) => b.text).join('\n');
}
