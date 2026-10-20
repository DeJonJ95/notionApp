import type { Source } from '@/lib/budgetAssist/assistant';

export const PERIOD = { start: '2026-07-01', end: '2026-09-30' };

export type Bill = { bill: string; due_date: string; status: string; days_late: number | null; paid_date: string | null };

export type Expected = {
  month_over_month: { totals: Record<string, number>; notable: { month: string; category: string; change_usd: number }[] };
  bill_payment_status: { bills: Bill[] };
  fast_food: { total: number; transactions: number; months: Record<string, number> };
};

export type EntryId = keyof Expected;

export type Entry = {
  [K in EntryId]: { id: K; question: string; expected: Expected[K]; verified_against_statement: boolean };
}[EntryId];

export type Golden = { generated_at: string; today: string; period: typeof PERIOD; entries: Entry[] };

export const QUESTIONS: Record<EntryId, string> = {
  month_over_month: 'How did my spending change month to month from July through September 2026?',
  bill_payment_status: 'Did I pay my bills on time from July 1 to September 30, 2026?',
  fast_food: 'How much did I spend on fast food each month from July through September 2026, and in total?',
};

export type Check = { entry: string; check: string; expected: unknown; actual: unknown; pass: boolean };
type Result = Omit<Check, 'entry'>;

const exact = (check: string, expected: unknown, actual: unknown): Result =>
  ({ check, expected, actual, pass: expected === actual });

const money = (check: string, expected: number, actual: unknown): Result =>
  ({ check, expected, actual, pass: typeof actual === 'number' && Math.abs(actual - expected) <= 0.01 + 1e-9 });

const ym = (v: unknown) => String(v ?? '').slice(0, 7);
const inPeriod = (d: unknown) => typeof d === 'string' && d >= PERIOD.start && d <= PERIOD.end;
const rowsOf = (sources: Source[], tool: string) => sources.filter((s) => s.tool === tool && !s.error).flatMap((s) => s.rows);

function checkMonthOverMonth(e: Expected['month_over_month'], sources: Source[]): Result[] {
  const rows = rowsOf(sources, 'month_over_month').filter((r) => ym(r.month) in e.totals);
  const totals = new Map(rows.filter((r) => r.is_total).map((r) => [ym(r.month), r.spend]));
  const notable = new Map(rows.filter((r) => r.notable && !r.is_total).map((r) => [`${ym(r.month)} ${r.category}`, r.change_usd]));
  return [
    ...Object.entries(e.totals).map(([m, v]) => money(`spend ${m}`, v, totals.get(m))),
    exact('notable changes', e.notable.length, notable.size),
    ...e.notable.map((n) => money(`${n.month} ${n.category} change`, n.change_usd, notable.get(`${n.month} ${n.category}`))),
  ];
}

function checkBills(e: Expected['bill_payment_status'], sources: Source[]): Result[] {
  const got = new Map(rowsOf(sources, 'bill_payment_status').filter((r) => inPeriod(r.due_date)).map((r) => [`${r.bill} ${r.due_date}`, r]));
  return [
    exact('bills due', e.bills.length, got.size),
    ...e.bills.flatMap((b) => {
      const r = got.get(`${b.bill} ${b.due_date}`);
      return [
        exact(`${b.bill} ${b.due_date} status`, b.status, r?.status),
        exact(`${b.bill} ${b.due_date} days late`, b.days_late, r ? r.days_late : undefined),
      ];
    }),
  ];
}

// The total has to come from a lookup over exactly the period; a sum of separate lookups is not in the sources.
function checkFastFood(e: Expected['fast_food'], sources: Source[]): Result[] {
  const ff = sources.filter((s) => s.tool === 'spend_by_merchant_group' && !s.error && s.args.group === 'fast_food');
  const whole = ff.find((s) => s.args.start_date === PERIOD.start && s.args.end_date === PERIOD.end);
  const total = whole?.rows.find((r) => r.kind === 'total');
  const months = new Map(ff.flatMap((s) => s.rows).filter((r) => r.kind === 'month').map((r) => [ym(r.month), r.amount]));
  return [
    money('total', e.total, total?.amount),
    exact('transactions', e.transactions, total?.transactions),
    ...Object.entries(e.months).map(([m, v]) => money(`spend ${m}`, v, months.get(m))),
  ];
}

export function checkEntry(entry: Entry, sources: Source[]): Check[] {
  const results =
    entry.id === 'month_over_month' ? checkMonthOverMonth(entry.expected, sources)
    : entry.id === 'bill_payment_status' ? checkBills(entry.expected, sources)
    : checkFastFood(entry.expected, sources);
  return results.map((r) => ({ entry: entry.id, ...r }));
}

const cell = (v: unknown) => (v === undefined ? '(missing)' : v === null ? 'null' : String(v));

export function table(checks: Check[]): string {
  const head = ['', 'entry', 'check', 'expected', 'actual'];
  const rows = checks.map((c) => [c.pass ? 'PASS' : 'FAIL', c.entry, c.check, cell(c.expected), cell(c.actual)]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const passed = checks.filter((c) => c.pass).length;
  return [head, ...rows].map((r) => r.map((v, i) => v.padEnd(widths[i])).join('  ')).join('\n') + `\n\n${passed}/${checks.length} checks passed`;
}
