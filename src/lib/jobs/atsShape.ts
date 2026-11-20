// Shapes the ATS-safe copy for one applicant system: heading names a literal
// parser recognises, date ranges in one spelling, and plain characters where
// the system mangles typographic ones. Wording inside a line never changes.

import { ATS, type AtsId } from './atsProfiles';
import type { Block } from './docxBlocks';

export type Shaped = { blocks: Block[]; changes: string[]; yearOnlyDates: number };

const CANON: [RegExp, string][] = [
  [/^(professional |work |relevant )?(experience|employment( history)?|work history|career history)$/i, 'Work Experience'],
  [/^(education|academic background|education (&|and) training)$/i, 'Education'],
  [/^((technical |core |key )?(skills|competencies)|technologies|tools)( (&|and) [a-z ]+)?$/i, 'Skills'],
  [/^(professional )?(summary|profile|objective)$/i, 'Summary'],
  [/^(certifications?|licenses)( (&|and) [a-z ]+)?$/i, 'Certifications'],
];

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2}`;
const range = () => new RegExp(`\\b(${DATE})\\s*(?:[-\\u2013\\u2014]|\\bto\\b)\\s*(${DATE}|present|current|now|ongoing)\\b`, 'gi');
const YEAR_ONLY = /^(19|20)\d{2}$/;

const PLAIN: [RegExp, string][] = [
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
];

function canonHeading(text: string): string {
  const bare = text.trim().replace(/:$/, '');
  return CANON.find(([re]) => re.test(bare))?.[1] ?? text;
}

const plainRange = (text: string) =>
  text.replace(range(), (_m, start: string, end: string) => `${start} - ${/^\d|^[a-z]+\.?\s+\d/i.test(end) ? end : 'Present'}`);

const plainChars = (text: string) => PLAIN.reduce((t, [re, to]) => t.replace(re, to), text);

function yearOnlyCount(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + [...b.text.matchAll(range())].filter((m) => YEAR_ONLY.test(m[1])).length, 0);
}

type Pass = { on: boolean; apply: (b: Block) => string; note: (n: number, renamed: string[]) => string };

function passes(id: AtsId): Pass[] {
  const p = ATS[id];
  return [
    {
      on: p.literalHeadings,
      apply: (b) => (b.kind === 'heading' ? canonHeading(b.text) : b.text),
      note: (_n, renamed) => `Renamed ${renamed.join(', ')} so ${p.name} files each section correctly.`,
    },
    {
      on: p.formFill,
      apply: (b) => plainRange(b.text),
      note: (n) => `Rewrote ${n} date range${n === 1 ? '' : 's'} as "start - end", with open roles ending in Present.`,
    },
    {
      on: p.asciiOnly,
      apply: (b) => plainChars(b.text),
      note: (n) => `Replaced curly quotes and long dashes with plain characters on ${n} line${n === 1 ? '' : 's'}.`,
    },
  ];
}

export function shapeForAts(blocks: Block[], id: AtsId): Shaped {
  let out = blocks;
  const changes: string[] = [];
  for (const pass of passes(id).filter((x) => x.on)) {
    const renamed: string[] = [];
    const next = out.map((b) => {
      const text = pass.apply(b);
      if (text !== b.text) renamed.push(`"${b.text}" to "${text}"`);
      return text === b.text ? b : { ...b, text };
    });
    if (renamed.length) changes.push(pass.note(renamed.length, renamed));
    out = next;
  }
  return { blocks: out, changes, yearOnlyDates: ATS[id].formFill ? yearOnlyCount(out) : 0 };
}
