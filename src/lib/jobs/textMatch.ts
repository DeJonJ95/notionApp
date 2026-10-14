// Locates an AI-quoted resume line inside real resume text. The model's quote
// drifts from the source in quotes, dashes, spacing, case and bullet glyphs,
// so matching runs on a normalized copy that keeps a map back to raw offsets.

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"' };
const DASH = /[‐‑‒–—―−]/;
const SPACE = /[\s  -​  　]/;
const BULLET_LEAD = /^[\s•●▪■◦‣∙·*\-–—•]+/;

type Normalized = { norm: string; map: number[] };

function normalize(raw: string): Normalized {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (SPACE.test(ch)) {
      if (norm.endsWith(' ') || norm.endsWith('-')) continue;
      ch = ' ';
    } else if (DASH.test(ch) || ch === '-') {
      if (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
      ch = '-';
    } else {
      ch = (QUOTES[ch] ?? ch).toLowerCase();
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

function needleOf(quote: string): string {
  return normalize(quote.replace(BULLET_LEAD, '')).norm.trim().replace(/[.;,]$/, '');
}

/** Raw [start, end) of `quote` inside `hay`, tolerant of formatting drift. */
export function findSpan(hay: string, quote: string): [number, number] | null {
  const needle = needleOf(quote);
  if (needle.length < 3) return null;
  const { norm, map } = normalize(hay);
  const at = norm.indexOf(needle);
  if (at < 0) return null;
  return [map[at], map[at + needle.length - 1] + 1];
}

/** Span a rewrite replaces: the quote, plus its closing mark when the rewrite brings its own. */
export function tweakSpan(hay: string, original: string, rewrite: string): [number, number] | null {
  const span = findSpan(hay, original);
  if (!span) return null;
  const last = rewrite.trim().slice(-1);
  if (/[.;,]/.test(last) && hay[span[1]] === last) span[1]++;
  return span;
}

function words(s: string): string[] {
  return needleOf(s).split(/[^a-z0-9%$+#]+/).filter(Boolean);
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const pool = new Map<string, number>();
  a.forEach((w) => pool.set(w, (pool.get(w) ?? 0) + 1));
  let shared = 0;
  b.forEach((w) => {
    const n = pool.get(w) ?? 0;
    if (n > 0) { shared++; pool.set(w, n - 1); }
  });
  return (2 * shared) / (a.length + b.length);
}

const SNAP_MIN = 0.85;

/**
 * The verbatim resume text the model meant by `quote`, or null when no line
 * is close enough. A quote the resume does not contain is how fabricated
 * "originals" show up, so those are dropped rather than guessed at.
 */
export function snapQuote(resumeText: string, quote: string): string | null {
  const lines = resumeText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const span = findSpan(line, quote);
    if (span) return line.slice(span[0], span[1]);
  }
  const target = words(quote);
  const candidates = [...lines, ...lines.slice(1).map((l, i) => `${lines[i]} ${l}`)];
  let best: { line: string; score: number } | null = null;
  for (const line of candidates) {
    const score = dice(target, words(line));
    if (!best || score > best.score) best = { line, score };
  }
  return best && best.score >= SNAP_MIN ? best.line.replace(BULLET_LEAD, '') : null;
}
