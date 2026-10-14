// Deterministic ATS audit. Parsing risks come from the styled file's XML;
// keyword, title, contact and section checks run on the text an ATS would
// extract. Nothing here calls a model, so the numbers are repeatable.

import PizZip from 'pizzip';
import { coverage, coreTitle, hasKeyword, type Coverage } from './keywords';
import { isSectionHeading, type Block } from './docxBlocks';

export type HazardId = 'tables' | 'textBoxes' | 'columns' | 'headerContact' | 'images' | 'symbols';

export type Hazard = { id: HazardId; label: string };

export type AtsReport = {
  keywords: Coverage;
  title: { text: string; found: boolean };
  contact: { email: boolean; phone: boolean };
  sections: { experience: boolean; education: boolean; skills: boolean };
  hazards: Hazard[];
};

const HAZARD_LABEL: Record<HazardId, string> = {
  tables: 'Uses tables for layout. Many ATS read table cells out of order or skip them.',
  textBoxes: 'Has text boxes. Most ATS ignore text box content entirely.',
  columns: 'Uses a multi-column layout. ATS often read across the columns and scramble lines.',
  headerContact: 'Contact details sit in the page header. Many ATS never read the header.',
  images: 'Contains images or icons. ATS cannot read them, so anything shown only as an icon is lost.',
  symbols: 'Uses symbol-font characters that ATS turn into garbage text.',
};

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

function partsText(zip: PizZip, pattern: RegExp): string {
  return zip.file(pattern).map((f) => f.asText().replace(/<[^>]+>/g, ' ')).join(' ');
}

/** Parsing risks in a styled .docx. */
export function docxHazards(buffer: Buffer): Hazard[] {
  const zip = new PizZip(buffer);
  const doc = zip.file('word/document.xml')?.asText() ?? '';
  const bodyText = doc.replace(/<[^>]+>/g, ' ');
  const headerText = partsText(zip, /^word\/(header|footer)\d*\.xml$/);
  const found: Record<HazardId, boolean> = {
    tables: /<w:tbl\b/.test(doc),
    textBoxes: /<w:txbxContent\b|<v:textbox\b/.test(doc),
    columns: /<w:cols\b[^>]*w:num="([2-9])"/.test(doc),
    headerContact: [EMAIL, PHONE].some((re) => re.test(headerText) && !re.test(bodyText)),
    images: /<a:blip\b|<v:imagedata\b/.test(doc),
    symbols: /<w:sym\b/.test(doc) || /[-]/.test(bodyText),
  };
  return (Object.keys(found) as HazardId[]).filter((id) => found[id]).map((id) => ({ id, label: HAZARD_LABEL[id] }));
}

const SECTION_TESTS = {
  experience: /experience|employment|work history|career history/i,
  education: /education|degree|academic/i,
  skills: /skills|competencies|technologies|tools/i,
};

function sections(blocks: Block[]): AtsReport['sections'] {
  const heads = blocks.filter((b) => b.kind === 'heading' || isSectionHeading(b.text)).map((b) => b.text);
  const has = (re: RegExp) => heads.some((h) => re.test(h));
  return { experience: has(SECTION_TESTS.experience), education: has(SECTION_TESTS.education), skills: has(SECTION_TESTS.skills) };
}

/** Audit the text an ATS extracts from the resume against one job. */
export function atsReport(
  blocks: Block[],
  job: { title: string; keywords: string[] },
  hazards: Hazard[] = [],
): AtsReport {
  const text = blocks.map((b) => b.text).join('\n');
  const core = coreTitle(job.title);
  return {
    keywords: coverage(text, job.keywords),
    title: { text: core, found: !!core && hasKeyword(text, core) },
    contact: { email: EMAIL.test(text), phone: PHONE.test(text) },
    sections: sections(blocks),
    hazards,
  };
}
