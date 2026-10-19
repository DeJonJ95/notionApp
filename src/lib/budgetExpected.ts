import {
  HALF_PERIOD_DAYS,
  MIN_PAYMENT_SHARE,
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

// `planned` marks a recurring forecast row: evidence a bill is due, never that it was paid.
export type LedgerTx = { date: string; vendor: string; amount: number; planned?: boolean };

export type RuleMatch = {
  ruleId: string;
  name: string;
  type: string;
  expectedAmt: number;
  expectedCount: number;
  matchedCount: number;
  unconfirmedCount: number;
  matchedTotal: number;
};

export type BillState = 'overdue' | 'unconfirmed';

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
  state: BillState;
};

const DAY_MS = 86_400_000;
const OVERDUE_LOOKBACK_DAYS = 60;
const NEXT_DUE_HORIZON_DAYS = 62;

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumAbs = (txs: LedgerTx[]) => txs.reduce((s, t) => s + Math.abs(t.amount), 0);
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
  const real = txs.filter((t) => !t.planned);
  const forecasts = txs.filter((t) => t.planned);

  for (const rule of rules) {
    const dueDates = occurrencesBetween(rule.anchorDate, rule.frequency as RuleFrequency, window.start, to);
    if (dueDates.length === 0) continue;
    out[rule.type === 'income' ? 'incomeExpected' : 'expenseExpected'] += dueDates.length * rule.amount;
    const payments = dueDates.map((due) => real.find((t) => matchesOccurrence(t, rule, due)));
    const matched = payments.filter((t) => t !== undefined);
    const unconfirmed = dueDates.filter(
      (due, i) => !payments[i] && forecasts.some((t) => matchesOccurrence(t, rule, due)),
    );
    out.rules.push({
      ruleId: rule.id,
      name: rule.name,
      type: rule.type,
      expectedAmt: rule.amount,
      expectedCount: dueDates.length,
      matchedCount: matched.length,
      unconfirmedCount: unconfirmed.length,
      matchedTotal: round2(sumAbs(matched)),
    });
  }

  out.incomeExpected = round2(out.incomeExpected);
  out.expenseExpected = round2(out.expenseExpected);
  out.incomeActual = round2(sumAbs(real.filter((t) => t.amount > 0)));
  out.expenseActual = round2(sumAbs(real.filter((t) => t.amount < 0)));
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
function unpaidBills(rule: RuleLike, dues: Date[], txs: LedgerTx[], today: Date): OverdueBill[] {
  const early = HALF_PERIOD_DAYS[rule.frequency as RuleFrequency] ?? 14;
  const ofRule = txs
    .filter((t) => t.amount < 0 && vendorsSimilar(t.vendor, rule.name))
    .sort((a, b) => a.date.localeCompare(b.date));
  const payments = ofRule.filter((t) => !t.planned && Math.abs(t.amount) >= rule.amount * MIN_PAYMENT_SHARE);
  const forecasts = ofRule.filter((t) => t.planned);
  const used = new Set<LedgerTx>();

  return dues.flatMap((due, i) => {
    if (due >= today) return [];
    const next = dues[i + 1] ?? new Date(due.getTime() + NEXT_DUE_HORIZON_DAYS * DAY_MS);
    const lo = due.getTime() - early * DAY_MS;
    const hi = next.getTime() - Math.ceil(early / 2) * DAY_MS;
    const take = (rows: LedgerTx[]) => {
      const hit = rows.find((t) => !used.has(t) && atMidnight(t.date) >= lo && atMidnight(t.date) < hi);
      if (hit) used.add(hit);
      return hit;
    };
    if (take(payments)) return [];
    const state: BillState = take(forecasts) ? 'unconfirmed' : 'overdue';
    return {
      ruleId: rule.id,
      name: rule.name,
      category: rule.category,
      amount: rule.amount,
      dueDate: ymd(due),
      daysOverdue: Math.round((today.getTime() - due.getTime()) / DAY_MS),
      state,
    };
  });
}

/** Expense rules whose due date has passed with no real payment for it. Where
 *  the engine's forecast row still stands, no statement covering that date has
 *  been imported, so the bill is 'unconfirmed'. An import archives the forecast
 *  for the dates it covers, so a due date with no row at all is 'overdue'. */
export function computeOverdueBills(rules: RuleLike[], txs: LedgerTx[], today: Date): OverdueBill[] {
  const end = dayStart(today);
  const lookback = new Date(end.getTime() - OVERDUE_LOOKBACK_DAYS * DAY_MS);
  const horizon = new Date(end.getTime() + NEXT_DUE_HORIZON_DAYS * DAY_MS);
  return rules
    .filter((rule) => rule.type !== 'income')
    .flatMap((rule) => {
      const from = rule.createdAt && rule.createdAt > lookback ? dayStart(rule.createdAt) : lookback;
      const dues = occurrencesBetween(anchorBefore(rule, from), rule.frequency as RuleFrequency, from, horizon);
      return unpaidBills(rule, dues, txs, end);
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
