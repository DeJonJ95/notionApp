// Waste detection over the transaction ledger.
//
// Every finding cites the transactions behind it. A budgeting tool that
// asserts "you are wasting $X" without showing the rows is unfalsifiable and
// gets ignored, so each detector returns its evidence and reports nothing it
// cannot support with real charges.
//
// Pure: no prisma, no next-auth, so all of it is unit-testable.

import { normalizeVendor } from './budgetDb';

export type WasteKind = 'fee' | 'price-creep' | 'subscription' | 'category-drift';

export type WasteFinding = {
  id: string;
  kind: WasteKind;
  title: string;
  detail: string;
  /** What acting on this plausibly saves per year. */
  annualImpact: number;
  evidence: { date: string; vendor: string; amount: number }[];
};

export type WasteTx = {
  date: string;      // YYYY-MM-DD
  vendor: string;
  amount: number;    // signed; only negatives are spending
  category: string;
  notes?: string;
};

const cents = (n: number) => Math.round(n * 100) / 100;
const monthOf = (d: string) => String(d ?? '').slice(0, 7);

// ── 1. Fees, interest and penalties ─────────────────────────────────────
// Word boundaries matter: a bare /fee/ flags every COFFEE purchase.
const FEE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bfees?\b/i, label: 'fee' },
  { re: /\boverdraft\b/i, label: 'overdraft' },
  { re: /\bnsf\b/i, label: 'insufficient funds' },
  { re: /\binsufficient funds\b/i, label: 'insufficient funds' },
  { re: /\bservice charge\b/i, label: 'service charge' },
  { re: /\bmaintenance charge\b/i, label: 'maintenance charge' },
  { re: /\bfinance charge\b/i, label: 'finance charge' },
  { re: /\binterest charged?\b/i, label: 'interest charge' },
  { re: /\bpenalty\b/i, label: 'penalty' },
  { re: /\blate charge\b/i, label: 'late charge' },
  { re: /\batm\b/i, label: 'ATM' },
];

export function matchFeeLabel(tx: WasteTx): string | null {
  const haystack = `${tx.vendor ?? ''} ${tx.notes ?? ''}`;
  for (const { re, label } of FEE_PATTERNS) if (re.test(haystack)) return label;
  return null;
}

/** Fees are the purest waste in a ledger: money that bought nothing. */
export function findFeeWaste(transactions: WasteTx[], monthsCovered: number): WasteFinding[] {
  const hits = transactions.filter((t) => t.amount < 0 && matchFeeLabel(t) !== null);
  if (hits.length === 0) return [];

  const total = cents(hits.reduce((s, t) => s + Math.abs(t.amount), 0));
  const perMonth = monthsCovered > 0 ? total / monthsCovered : total;
  const kinds = Array.from(new Set(hits.map((t) => matchFeeLabel(t) as string))).sort();

  return [{
    id: 'fees',
    kind: 'fee',
    title: `${hits.length} fee charge${hits.length === 1 ? '' : 's'} totalling ${money(total)}`,
    detail: `Money that bought nothing: ${kinds.join(', ')}. Most are avoidable with a fee-free account, a small buffer, or in-network ATMs.`,
    annualImpact: cents(perMonth * 12),
    evidence: hits
      .slice()
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 12)
      .map(ev),
  }];
}

// ── 2. Price creep on repeat charges ────────────────────────────────────
/** A vendor billed regularly whose price has climbed. Compares the earliest
 *  third of charges with the latest third, so one anomalous month cannot
 *  manufacture a trend. */
export function findPriceCreep(
  transactions: WasteTx[],
  opts: { minCharges?: number; minPctIncrease?: number; minMonthlyDelta?: number } = {},
): WasteFinding[] {
  const minCharges = opts.minCharges ?? 4;
  const minPct = opts.minPctIncrease ?? 10;
  const minDelta = opts.minMonthlyDelta ?? 1;

  const byVendor = new Map<string, WasteTx[]>();
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    const key = normalizeVendor(t.vendor);
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(t);
  }

  const out: WasteFinding[] = [];
  for (const [key, txs] of byVendor) {
    if (txs.length < minCharges) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));

    const slice = Math.max(1, Math.floor(txs.length / 3));
    const early = txs.slice(0, slice);
    const late = txs.slice(-slice);
    const avg = (rows: WasteTx[]) => rows.reduce((s, t) => s + Math.abs(t.amount), 0) / rows.length;
    const before = avg(early);
    const after = avg(late);
    if (before <= 0) continue;

    const delta = after - before;
    const pct = (delta / before) * 100;
    if (pct < minPct || delta < minDelta) continue;

    const spanDays =
      (new Date(txs[txs.length - 1].date + 'T00:00:00').getTime() -
        new Date(txs[0].date + 'T00:00:00').getTime()) / 86_400_000;
    if (spanDays < 45) continue; // too short a window to call it a trend
    const perYear = (txs.length - 1) / (spanDays / 365);

    out.push({
      id: `creep:${key}`,
      kind: 'price-creep',
      title: `${txs[txs.length - 1].vendor} went from ${money(before)} to ${money(after)}`,
      detail: `Up ${Math.round(pct)}% across ${txs.length} charges. At about ${perYear.toFixed(0)} charges a year, the increase alone costs ${money(delta * perYear)} annually.`,
      annualImpact: cents(delta * perYear),
      evidence: [...early.map(ev), ...late.map(ev)],
    });
  }
  return out;
}

// ── 3. Subscription load ────────────────────────────────────────────────
export type DetectedSubscription = {
  vendor: string;
  averageAmount: number;
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  occurrences: number;
};

const PER_YEAR: Record<DetectedSubscription['frequency'], number> = {
  weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12,
};

/** Small recurring charges hide because the monthly figure is trivial.
 *  Restating them annually is the entire point. */
export function findSubscriptionWaste(
  subscriptions: DetectedSubscription[],
  transactions: WasteTx[],
): WasteFinding[] {
  if (subscriptions.length === 0) return [];

  const evidenceFor = (vendor: string) =>
    transactions
      .filter((t) => t.amount < 0 && normalizeVendor(t.vendor) === normalizeVendor(vendor))
      .slice(-4)
      .map(ev);

  return subscriptions
    .map((s) => {
      const annual = cents(s.averageAmount * PER_YEAR[s.frequency]);
      return {
        id: `sub:${normalizeVendor(s.vendor)}`,
        kind: 'subscription' as const,
        title: `${s.vendor} costs ${money(annual)} a year`,
        detail: `${money(s.averageAmount)} ${s.frequency}, seen ${s.occurrences} times. Cancelling frees ${money(annual)} a year.`,
        annualImpact: annual,
        evidence: evidenceFor(s.vendor),
      };
    })
    .sort((a, b) => b.annualImpact - a.annualImpact);
}

// ── 4. A category running hot against its own history ───────────────────
/** Compares the most recent COMPLETE month against the median of the months
 *  before it. Median rather than mean, so one blowout month cannot raise the
 *  bar and hide a genuine trend. */
export function findCategoryDrift(
  transactions: WasteTx[],
  today: Date,
  opts: { lookbackMonths?: number; minPctOver?: number; minDelta?: number } = {},
): WasteFinding[] {
  const lookback = opts.lookbackMonths ?? 6;
  const minPct = opts.minPctOver ?? 40;
  const minDelta = opts.minDelta ?? 25;

  const months: string[] = [];
  for (let i = 1; i <= lookback; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const latest = months[0];
  const priorMonths = months.slice(1);
  if (priorMonths.length < 2) return [];

  const byCatMonth = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    const m = monthOf(t.date);
    if (!months.includes(m)) continue;
    const cat = t.category || 'Other';
    if (!byCatMonth.has(cat)) byCatMonth.set(cat, new Map());
    const inner = byCatMonth.get(cat)!;
    inner.set(m, (inner.get(m) ?? 0) + Math.abs(t.amount));
  }

  const out: WasteFinding[] = [];
  for (const [cat, perMonth] of byCatMonth) {
    const now = perMonth.get(latest) ?? 0;
    const priors = priorMonths.map((m) => perMonth.get(m) ?? 0).filter((v) => v > 0);
    if (priors.length < 2 || now <= 0) continue;

    const median = medianOf(priors);
    if (median <= 0) continue;
    const delta = now - median;
    const pct = (delta / median) * 100;
    if (pct < minPct || delta < minDelta) continue;

    out.push({
      id: `drift:${cat}`,
      kind: 'category-drift',
      title: `${cat} ran ${Math.round(pct)}% above normal`,
      detail: `${money(now)} last month against a typical ${money(median)}. Holding it to normal saves ${money(delta)} a month.`,
      annualImpact: cents(delta * 12),
      evidence: transactions
        .filter((t) => t.amount < 0 && (t.category || 'Other') === cat && monthOf(t.date) === latest)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 6)
        .map(ev),
    });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────
function ev(t: WasteTx) {
  return { date: t.date, vendor: t.vendor, amount: t.amount };
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0,
  }).format(n);
}
