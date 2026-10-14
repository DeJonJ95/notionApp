// One tailoring pass: apply the approved tweaks, then build the ATS-safe copy
// from the result and audit it. A .docx base also yields the styled file with
// the user's own design; a PDF base can only yield the ATS-safe copy.

import { tailorDocx, type Tweak } from './docx';
import { docxBlocks, textBlocks, type Block } from './docxBlocks';
import { plainDocx } from './plainDocx';
import { atsReport, docxHazards, type AtsReport } from './atsCheck';
import { tweakSpan } from './textMatch';

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
    let hit = false;
    out.forEach((b) => {
      const span = tweakSpan(b.text, t.original, t.rewrite);
      if (!span) return;
      b.text = b.text.slice(0, span[0]) + t.rewrite.trim() + b.text.slice(span[1]);
      hit = true;
    });
    return !hit;
  });
  return { blocks: out, unmatched };
}

export function tailorFromDocx(original: Buffer, tweaks: Tweak[], job: Job): TailorOutput {
  const { bytes, applied, unmatched } = tailorDocx(original, tweaks);
  const blocks = docxBlocks(bytes);
  return {
    styled: bytes,
    plain: plainDocx(blocks),
    applied,
    unmatched,
    report: atsReport(blocks, job, docxHazards(bytes)),
  };
}

export function tailorFromText(parsedText: string, tweaks: Tweak[], job: Job): TailorOutput {
  const wanted = tweaks.filter((t) => t.original?.trim() && t.rewrite?.trim());
  const { blocks, unmatched } = tailorBlocks(textBlocks(parsedText), wanted);
  return {
    styled: null,
    plain: plainDocx(blocks),
    applied: wanted.length - unmatched.length,
    unmatched,
    report: atsReport(blocks, job),
  };
}
