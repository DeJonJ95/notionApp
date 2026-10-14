// Keyword presence the way an ATS search sees it: the literal term in the
// extracted text, forgiving only separators ("Node.js" = "nodejs" = "node js")
// and a plural "s". A synonym does not count, which is the point of measuring.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = /[\s.\-_/]+/;

function termPattern(term: string): RegExp | null {
  const parts = term.trim().toLowerCase().split(SEP).filter(Boolean);
  if (!parts.length || parts.join('').length < 2) return null;
  const body = parts.map(escape).join('[\\s.\\-_/]*');
  return new RegExp(`(^|[^a-z0-9])${body}s?($|[^a-z0-9+#])`);
}

export function hasKeyword(text: string, term: string): boolean {
  const re = termPattern(term);
  return !!re && re.test(text.toLowerCase());
}

export type Coverage = { matched: string[]; missing: string[] };

export function coverage(text: string, keywords: string[]): Coverage {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];
  uniqueTerms(keywords).forEach((k) => (hasKeyword(lower, k) ? matched : missing).push(k));
  return { matched, missing };
}

export function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.map((t) => t.trim()).filter((t) => {
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keywords a rewrite brings into the resume that it did not already contain. */
export function keywordsAdded(keywords: string[], resumeText: string, rewrite: string): string[] {
  return uniqueTerms(keywords).filter((k) => hasKeyword(rewrite, k) && !hasKeyword(resumeText, k));
}

const FIGURE = /[$£€]?\d[\d,.]*\s?(%|k|m|x|\+)?/gi;

/**
 * Figures in a rewrite that the original line never stated. Invented metrics
 * are the most common way a "truthful rewording" stops being truthful, so the
 * UI leaves these tweaks unticked until the user confirms the number.
 */
export function newFigures(original: string, rewrite: string): string[] {
  const norm = (f: string) => f.toLowerCase().replace(/[\s,]/g, '').replace(/\.$/, '');
  const had = new Set((original.match(FIGURE) ?? []).map(norm));
  return uniqueTerms((rewrite.match(FIGURE) ?? []).map((f) => f.trim().replace(/[.,]$/, '')))
    .filter((f) => !had.has(norm(f)));
}

const SENIORITY = /\b(senior|sr|junior|jr|lead|staff|principal|associate|entry[- ]level|mid[- ]level|i{1,3}|iv|[1-4])\b\.?/gi;

/** The role itself, minus seniority and location noise: "Senior Data Engineer (Remote)" -> "Data Engineer". */
export function coreTitle(title: string): string {
  return title
    .replace(/\(.*?\)/g, ' ')
    .split(/\s[-–|,@]\s|,/)[0]
    .replace(SENIORITY, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
