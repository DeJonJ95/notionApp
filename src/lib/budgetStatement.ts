export type StatementMeta = {
  account: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null;   // YYYY-MM-DD, as printed in the statement header
  periodEnd: string | null;
};

export const EMPTY_META: StatementMeta = {
  account: null, openingBalance: null, closingBalance: null, periodStart: null, periodEnd: null,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Longer than any monthly statement; a "period" past this is a misread header.
const MAX_PERIOD_DAYS = 62;
const DAY_MS = 86_400_000;

export function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const isoDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim().slice(0, 10);
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};

export function parseMeta(parsed: unknown): StatementMeta {
  const m = (parsed as { meta?: unknown } | null)?.meta;
  if (!m || typeof m !== 'object') return EMPTY_META;
  const raw = m as Record<string, unknown>;
  const account = String(raw.account ?? '').trim().slice(0, 80);
  return {
    account: account || null,
    openingBalance: num(raw.openingBalance),
    closingBalance: num(raw.closingBalance),
    periodStart: isoDate(raw.periodStart),
    periodEnd: isoDate(raw.periodEnd),
  };
}

/** The dates a statement is the record for: its printed period when that is
 *  plausible and overlaps its own transactions, otherwise first to last
 *  transaction. Days in the period with no transactions are still covered, so a
 *  bill due on one of them is judged against this statement. */
export function statementRange(
  meta: { periodStart?: unknown; periodEnd?: unknown } | null | undefined,
  txDates: string[],
): { from: string; to: string } | null {
  const dates = txDates.map((d) => isoDate(d)).filter((d): d is string => d !== null).sort();
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const start = isoDate(meta?.periodStart);
  const end = isoDate(meta?.periodEnd);
  const plausible = start !== null && end !== null && start <= end
    && Date.parse(end) - Date.parse(start) <= MAX_PERIOD_DAYS * DAY_MS
    && start <= last && end >= first;
  if (!plausible) return { from: first, to: last };
  return { from: start < first ? start : first, to: end > last ? end : last };
}

export type ImportRange = { account: string | null; from: string; to: string };
export type CoverageGap = { from: string; to: string; days: number };
export type StatementCoverage = { account: string | null; from: string; through: string; gaps: CoverageGap[] };

const dayOf = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** How far imported statements reach for the account of the latest one, and
 *  the holes in between. An import that named no account counts for any. A
 *  hole of `minGapDays` or fewer is bridged: older imports only span first to
 *  last transaction, so a quiet weekend between two of them is not missing. */
export function statementCoverage(imports: ImportRange[], minGapDays = 3): StatementCoverage | null {
  const valid = imports.filter((r) => isoDate(r.from) && isoDate(r.to) && r.from <= r.to);
  if (valid.length === 0) return null;
  const latest = [...valid].sort((a, b) => b.to.localeCompare(a.to) || Number(!!b.account) - Number(!!a.account))[0];
  const ranges = valid
    .filter((r) => !latest.account || !r.account || r.account === latest.account)
    .sort((a, b) => a.from.localeCompare(b.from));
  const gaps: CoverageGap[] = [];
  let through = ranges[0].to;
  for (const r of ranges.slice(1)) {
    const days = Math.round((dayOf(r.from) - dayOf(through)) / DAY_MS) - 1;
    if (days > minGapDays) gaps.push({ from: isoOf(dayOf(through) + DAY_MS), to: isoOf(dayOf(r.from) - DAY_MS), days });
    if (r.to > through) through = r.to;
  }
  return { account: latest.account, from: ranges[0].from, through, gaps };
}
