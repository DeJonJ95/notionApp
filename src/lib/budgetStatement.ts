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
