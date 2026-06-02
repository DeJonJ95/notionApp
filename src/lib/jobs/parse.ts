// Lightweight heuristics for pulling structured fields out of a raw job
// posting at ingest time. These are best-effort first guesses (the AI
// analyze step refines/overrides them); the goal is to pre-fill the tracker
// so a freshly captured job isn't blank.

export type ParsedJob = {
  compMin?: number;
  compMax?: number;
  remote: boolean;
  location?: string;
};

// Match "$120,000", "$120k", "120K - 160K", "$120,000–$160,000/yr" etc.
const MONEY = /\$?\s*(\d{2,3}(?:,\d{3})?|\d{2,3})\s*(k|,000)?/gi;

function toAnnual(num: number, suffix?: string): number {
  if (suffix && suffix.toLowerCase() === 'k') return num * 1000;
  return num; // already full (e.g. 120,000 with comma stripped) or a small k-less number
}

export function parseCompensation(text: string): { compMin?: number; compMax?: number } {
  // Look only near salary cue words to avoid grabbing random dollar figures.
  const cueIdx = text.search(/salary|compensation|\bpay\b|base|\$\d|\bUSD\b|per year|\/yr|annually/i);
  if (cueIdx < 0) return {};
  const window = text.slice(Math.max(0, cueIdx - 40), cueIdx + 240);
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  MONEY.lastIndex = 0;
  while ((m = MONEY.exec(window)) !== null) {
    const raw = Number(m[1].replace(/,/g, ''));
    if (!raw) continue;
    const val = toAnnual(raw, m[2]);
    // Plausible annual salary band, filters out "401k", years, small nums.
    if (val >= 30_000 && val <= 1_000_000) nums.push(val);
  }
  if (nums.length === 0) return {};
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { compMin: min, compMax: max === min ? undefined : max };
}

export function detectRemote(text: string): boolean {
  return /\bremote\b|work from home|wfh|distributed team/i.test(text);
}

export function parseJob(text: string): ParsedJob {
  return {
    ...parseCompensation(text),
    remote: detectRemote(text),
  };
}
