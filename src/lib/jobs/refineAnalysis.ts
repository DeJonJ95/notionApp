// Server-side checks on the model's analysis before it is stored. The model
// proposes; this decides what the user is shown. Tweaks are pinned to text
// the resume really contains, and each one carries the keywords it adds and
// any figure or rank it introduced, computed here rather than trusted from the model.

import type { AnalysisResult } from './deepseek';
import { coverage, keywordsAdded, unverifiedClaims, uniqueTerms } from './keywords';
import { snapQuote } from './textMatch';

export type RefinedTweak = {
  resumeId: string;
  original: string;
  rewrite: string;
  reason: string;
  adds: string[];
  unverified: string[];
};

type ResumeText = { id: string; parsedText: string };

const MAX_KEYWORDS = 25;

/** House style for generated prose: no em dashes. */
export function plainDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ', ').replace(/,\s*,/g, ',');
}

function same(a: string, b: string): boolean {
  return a.replace(/\W+/g, '').toLowerCase() === b.replace(/\W+/g, '').toLowerCase();
}

export function refineTweaks(
  raw: AnalysisResult['suggestedTweaks'],
  resume: ResumeText,
  keywords: string[],
): RefinedTweak[] {
  const out: RefinedTweak[] = [];
  for (const t of raw) {
    const original = snapQuote(resume.parsedText, String(t?.original ?? ''));
    const rewrite = plainDashes(String(t?.rewrite ?? '').trim());
    if (!original || !rewrite || same(original, rewrite)) continue;
    if (out.some((o) => o.original === original)) continue;
    out.push({
      resumeId: resume.id,
      original,
      rewrite,
      reason: String(t?.reason ?? ''),
      adds: keywordsAdded(keywords, resume.parsedText, rewrite),
      unverified: unverifiedClaims(original, rewrite),
    });
  }
  return out;
}

/** Keywords each resume already contains, keyed by resume id. */
export function coverageByResume(resumes: ResumeText[], keywords: string[]): Record<string, string[]> {
  return Object.fromEntries(resumes.map((r) => [r.id, coverage(r.parsedText, keywords).matched]));
}

export function refineAnalysis(result: AnalysisResult, resumes: ResumeText[]) {
  const keywords = uniqueTerms(result.keywords).slice(0, MAX_KEYWORDS);
  const recommended = resumes.find((r) => r.id === result.recommendedResumeId) ?? resumes[0];
  return {
    ...result,
    keywords,
    suggestedTweaks: refineTweaks(result.suggestedTweaks, recommended, keywords),
    coverage: coverageByResume(resumes, keywords),
  };
}
