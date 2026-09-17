import {
  HALF_PERIOD_DAYS,
  occurrencesBetween,
  vendorsSimilar,
  type RuleFrequency,
} from '@/lib/budgetDb';

export type RuleLike = {
  id: string;
  name: string;
  type: string;
  amount: number;
  category: string;
  anchorDate: Date;
  frequency: string;
  createdAt?: Date;
};

export type LedgerTx = { date: string; vendor: string; amount: number };

export type RuleMatch = {
  ruleId: string;
  name: string;
  type: string;
  expectedAmt: number;
  expectedCount: number;
  matchedCount: number;
  matchedTotal: number;
};

export type ExpectedVsActual = {
  incomeExpected: number;
  incomeActual: number;
  expenseExpected: number;
  expenseActual: number;
  rules: RuleMatch[];
};

export type OverdueBill = {
  ruleId: string;
  name: string;
  category: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
};

const DAY_MS = 86_400_000;
const OVERDUE_LOOKBACK_DAYS = 60;
const NEXT_DUE_HORIZON_DAYS = 62;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const atMidnight = (iso: string) => new Date(iso + 'T00:00:00').getTime();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function emptyExpectedVsActual(): ExpectedVsActual {
  return { incomeExpected: 0, incomeActual: 0, expenseExpected: 0, expenseActual: 0, rules: [] };
}

function matchesOccurrence(t: LedgerTx, rule: RuleLike, due: Date): boolean {
  if (!vendorsSimilar(t.vendor, rule.name)) return false;
  if (Math.abs(Math.abs(t.amount) - rule.amount) / rule.amount > 0.3) return false;
  return Math.abs(atMidnight(t.date) - due.getTime()) <= 3 * DAY_MS;
}

export function computeExpectedVsActual(
  rules: RuleLike[],
  txs: LedgerTx[],
  window: { start: Date; end: Date; now?: Date },
): ExpectedVsActual {
  const to = new Date(Math.min(window.end.getTime(), (window.now ?? new Date()).getTime()));
  const out = emptyExpectedVsActual();

  for (const rule of rules) {
    const dueDates = occurrencesBetween(rule.anchorDate, rule.frequency as RuleFrequency, window.start, to);
    if (dueDates.length === 0) continue;

    const expectedTotal = dueDates.length * rule.amount;
    if (rule.type === 'income') out.incomeExpected += expectedTotal;
    else out.expenseExpected += expectedTotal;

    let matchedCount = 0;
    let matchedTotal = 0;
    for (const due of dueDates) {
      const match = txs.find((t) => matchesOccurrence(t, rule, due));
      if (!match) continue;
      matchedCount++;
      matchedTotal += Math.abs(match.amount);
    }
    out.rules.push({
      ruleId: rule.id,
      name: rule.name,
      type: rule.type,
      expectedAmt: rule.amount,
      expectedCount: dueDates.length,
      matchedCount,
      matchedTotal: round2(matchedTotal),
    });
  }

  out.incomeExpected = round2(out.incomeExpected);
  out.expenseExpected = round2(out.expenseExpected);
  out.incomeActual = round2(txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  out.expenseActual = round2(txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0));
  return out;
}

// The engine advances a rule's anchor past today, and the weekly/biweekly
// branch of occurrencesBetween only walks forward from the anchor, so it has
// to be rolled back before it can see the dates this report is about.
function anchorBefore(rule: RuleLike, from: Date): Date {
  const stride = rule.frequency === 'weekly' ? 7 : rule.frequency === 'biweekly' ? 14 : 0;
  const a = new Date(rule.anchorDate);
  if (stride > 0) while (a > from) a.setDate(a.getDate() - stride);
  return a;
}

// A payment counts for an occurrence from a little before its due date up
// until shortly before the next one, so a late payment still clears the bill
// instead of being read as next month's early payment.
function paymentWindow(due: Date, next: Date, frequency: RuleFrequency): [number, number] {
  const early = HALF_PERIOD_DAYS[frequency] ?? 14;
  return [due.getTime() - early * DAY_MS, next.getTime() - Math.ceil(early / 2) * DAY_MS];
}

function unpaidOccurrences(rule: RuleLike, dues: Date[], txs: LedgerTx[], today: Date): Date[] {
  const frequency = rule.frequency as RuleFrequency;
  const candidates = txs
    .filter((t) => t.amount < 0 && vendorsSimilar(t.vendor, rule.name))
    .sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<LedgerTx>();
  const unpaid: Date[] = [];

  dues.forEach((due, i) => {
    if (due >= today) return;
    const next = dues[i + 1] ?? new Date(due.getTime() + NEXT_DUE_HORIZON_DAYS * DAY_MS);
    const [lo, hi] = paymentWindow(due, next, frequency);
    const hit = candidates.find((t) => {
      if (used.has(t)) return false;
      const at = atMidnight(t.date);
      return at >= lo && at < hi;
    });
    if (hit) used.add(hit);
    else unpaid.push(due);
  });
  return unpaid;
}

/** Expense rules whose due date has passed with no row in the ledger for it:
 *  neither a real payment nor the engine's Planned placeholder. The placeholder
 *  is archived when an import covers its date, so its absence means the
 *  statement for that period showed no such charge. */
export function computeOverdueBills(rules: RuleLike[], txs: LedgerTx[], today: Date): OverdueBill[] {
  const end = dayStart(today);
  const lookback = new Date(end.getTime() - OVERDUE_LOOKBACK_DAYS * DAY_MS);
  const horizon = new Date(end.getTime() + NEXT_DUE_HORIZON_DAYS * DAY_MS);
  const out: OverdueBill[] = [];

  for (const rule of rules) {
    if (rule.type === 'income') continue;
    const from = rule.createdAt && rule.createdAt > lookback ? dayStart(rule.createdAt) : lookback;
    const frequency = rule.frequency as RuleFrequency;
    const dues = occurrencesBetween(anchorBefore(rule, from), frequency, from, horizon);
    for (const due of unpaidOccurrences(rule, dues, txs, end)) {
      out.push({
        ruleId: rule.id,
        name: rule.name,
        category: rule.category,
        amount: rule.amount,
        dueDate: ymd(due),
        daysOverdue: Math.round((end.getTime() - due.getTime()) / DAY_MS),
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
