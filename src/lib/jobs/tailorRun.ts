// One tailoring pass: apply the approved tweaks, then build the ATS-safe copy
// from the result and audit it. A .docx base also yields the styled file with
// the user's own design; a PDF base can only yield the ATS-safe copy.

import { tailorDocx, type Tweak } from './docx';
import { docxBlocks, textBlocks, blocksText, type Block } from './docxBlocks';
import { plainDocx } from './plainDocx';
import { atsReport, docxHazards, type AtsReport } from './atsCheck';
import { tweakSpan } from './textMatch';
import { coverage } from './keywords';

export type TailorOutput = {
  styled: Buffer | null;
  plain: Buffer;
  applied: number;
  unmatched: Tweak[];
  report: AtsReport;
};

type Job = { title: string; keywords: string[] };

function tailorBlocks(blocks: Block[], tweaks: Tweak[]): { blocks: Block[]; unmatched: Tweak[] } {
  const out = blocks.map((b) => ({ ...b }));
  const unmatched = tweaks.filter((t) => {
    for (const b of out) {
      const span = tweakSpan(b.text, t.original, t.rewrite);
      if (!span) continue;
      b.text = b.text.slice(0, span[0]) + t.rewrite.trim() + b.text.slice(span[1]);
      return false;
    }
    return true;
  });
  return { blocks: out, unmatched };
}

// Keyword count of the untailored resume, read by the same extractor as the report.
const countBefore = (base: Block[], job: Job) => coverage(blocksText(base), job.keywords).matched.length;

export function tailorFromDocx(original: Buffer, tweaks: Tweak[], job: Job): TailorOutput {
  const { bytes, applied, unmatched } = tailorDocx(original, tweaks);
  const blocks = docxBlocks(bytes);
  return {
    styled: bytes,
    plain: plainDocx(blocks),
    applied,
    unmatched,
    report: { ...atsReport(blocks, job, docxHazards(bytes)), before: countBefore(docxBlocks(original), job) },
  };
}

export function tailorFromText(parsedText: string, tweaks: Tweak[], job: Job): TailorOutput {
  const wanted = tweaks.filter((t) => t.original?.trim() && t.rewrite?.trim());
  const base = textBlocks(parsedText);
  const { blocks, unmatched } = tailorBlocks(base, wanted);
  return {
    styled: null,
    plain: plainDocx(blocks),
    applied: wanted.length - unmatched.length,
    unmatched,
    report: { ...atsReport(blocks, job), before: countBefore(base, job) },
  };
}
