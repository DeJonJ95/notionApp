import {
  HALF_PERIOD_DAYS,
  MIN_PAYMENT_SHARE,
  TRANSFERS_CATEGORY,
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
export type LedgerTx = { date: string; vendor: string; amount: number; planned?: boolean; category?: string };

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

type Settled = { due: Date; payment: LedgerTx | null; forecast: boolean };

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 60;
const NEXT_DUE_HORIZON_DAYS = 62;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const atMidnight = (iso: string) => new Date(iso + 'T00:00:00').getTime();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function emptyExpectedVsActual(): ExpectedVsActual {
  return { incomeExpected: 0, incomeActual: 0, expenseExpected: 0, expenseActual: 0, rules: [] };
}

// The engine advances a rule's anchor past today, and the weekly/biweekly
// branch of occurrencesBetween only walks forward from the anchor, so it has
// to be rolled back before it can see the dates a report is about.
function duesBetween(rule: RuleLike, from: Date, to: Date): Date[] {
  const stride = rule.frequency === 'weekly' ? 7 : rule.frequency === 'biweekly' ? 14 : 0;
  const anchor = new Date(rule.anchorDate);
  if (stride > 0) while (anchor > from) anchor.setDate(anchor.getDate() - stride);
  return occurrencesBetween(anchor, rule.frequency as RuleFrequency, from, to);
}

/** Pairs each due date with the real payment that settled it, oldest first, so
 *  one payment never settles two dates. A payment counts from a little before
 *  its due date until shortly before the next one, so a late payment still
 *  clears the bill instead of reading as next period's early one. It must go
 *  the rule's way and be at least MIN_PAYMENT_SHARE of the bill. */
function settle(rule: RuleLike, dues: Date[], txs: LedgerTx[]): Settled[] {
  const early = HALF_PERIOD_DAYS[rule.frequency as RuleFrequency] ?? 14;
  const sign = rule.type === 'income' ? 1 : -1;
  const ofRule = txs
    .filter((t) => Math.sign(t.amount) === sign && vendorsSimilar(t.vendor, rule.name))
    .sort((a, b) => a.date.localeCompare(b.date));
  const payments = ofRule.filter((t) => !t.planned && Math.abs(t.amount) >= rule.amount * MIN_PAYMENT_SHARE);
  const forecasts = ofRule.filter((t) => t.planned);
  const used = new Set<LedgerTx>();

  return dues.map((due, i) => {
    const next = dues[i + 1] ?? addDays(due, NEXT_DUE_HORIZON_DAYS);
    const lo = due.getTime() - early * DAY_MS;
    const hi = next.getTime() - Math.ceil(early / 2) * DAY_MS;
    const take = (rows: LedgerTx[]) => {
      const hit = rows.find((t) => !used.has(t) && atMidnight(t.date) >= lo && atMidnight(t.date) < hi);
      if (hit) used.add(hit);
      return hit ?? null;
    };
    const payment = take(payments);
    return { due, payment, forecast: !payment && take(forecasts) !== null };
  });
}

/** Settles a rule's due dates from `from` through `to`. Settling starts a
 *  lookback earlier and runs a horizon past the end, so a payment is claimed by
 *  the due date it belongs to rather than whichever falls inside the window. */
function settledBetween(rule: RuleLike, txs: LedgerTx[], from: Date, to: Date): Settled[] {
  const dues = duesBetween(rule, addDays(from, -LOOKBACK_DAYS), addDays(to, NEXT_DUE_HORIZON_DAYS));
  return settle(rule, dues, txs).filter((s) => s.due >= from && s.due <= to);
}

export function computeExpectedVsActual(
  rules: RuleLike[],
  txs: LedgerTx[],
  window: { start: Date; end: Date; now?: Date },
): ExpectedVsActual {
  const to = new Date(Math.min(window.end.getTime() - 1, (window.now ?? new Date()).getTime()));
  const out = emptyExpectedVsActual();

  for (const rule of rules) {
    const settled = settledBetween(rule, txs, window.start, to);
    if (settled.length === 0) continue;
    out[rule.type === 'income' ? 'incomeExpected' : 'expenseExpected'] += settled.length * rule.amount;
    const paid = settled.filter((s) => s.payment);
    out.rules.push({
      ruleId: rule.id,
      name: rule.name,
      type: rule.type,
      expectedAmt: rule.amount,
      expectedCount: settled.length,
      matchedCount: paid.length,
      unconfirmedCount: settled.filter((s) => s.forecast).length,
      matchedTotal: round2(paid.reduce((sum, s) => sum + Math.abs(s.payment!.amount), 0)),
    });
  }

  const posted = txs.filter((t) =>
    !t.planned && t.category !== TRANSFERS_CATEGORY
    && atMidnight(t.date) >= window.start.getTime() && atMidnight(t.date) < window.end.getTime());
  out.incomeExpected = round2(out.incomeExpected);
  out.expenseExpected = round2(out.expenseExpected);
  out.incomeActual = round2(posted.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  out.expenseActual = round2(posted.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0));
  return out;
}

/** Expense rules whose due date has passed with no real payment for it. Where
 *  the engine's forecast row still stands, no statement covering that date has
 *  been imported, so the bill is 'unconfirmed'. An import archives the forecast
 *  for the dates it covers, so a due date with no row at all is 'overdue'. */
export function computeOverdueBills(rules: RuleLike[], txs: LedgerTx[], today: Date): OverdueBill[] {
  const end = dayStart(today);
  const lookback = addDays(end, -LOOKBACK_DAYS);
  return rules
    .filter((rule) => rule.type !== 'income')
    .flatMap((rule) => {
      const from = rule.createdAt && rule.createdAt > lookback ? dayStart(rule.createdAt) : lookback;
      return settledBetween(rule, txs, from, addDays(end, -1))
        .filter((s) => !s.payment)
        .map((s) => ({
          ruleId: rule.id,
          name: rule.name,
          category: rule.category,
          amount: rule.amount,
          dueDate: ymd(s.due),
          daysOverdue: Math.round((end.getTime() - s.due.getTime()) / DAY_MS),
          state: s.forecast ? 'unconfirmed' as const : 'overdue' as const,
        }));
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
