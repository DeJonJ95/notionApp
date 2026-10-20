'use client';
import { useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import type { DueDateStatus, ExpectedVsActual, RuleMatch } from '@/lib/budgetExpected';
import { Section } from './Section';

type Side = 'income' | 'expense';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmt2 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const STATE = {
  paid: { Icon: CheckCircle2, ink: 'text-green-600' },
  unconfirmed: { Icon: Clock, ink: 'text-yellow-600' },
  overdue: { Icon: AlertTriangle, ink: 'text-red-500' },
};

function detail(d: DueDateStatus, side: Side): string {
  if (d.payment) return `${side === 'income' ? 'Received' : 'Paid'} ${fmt2(d.payment.amount)} on ${day(d.payment.date)} · ${d.payment.vendor}`;
  if (d.state === 'overdue') return 'No payment on the statement that covers this date';
  return 'Not confirmed yet: no imported statement reaches this date';
}

const dueRows = (rules: RuleMatch[], side: Side) =>
  rules
    .filter((r) => (r.type === 'income') === (side === 'income'))
    .flatMap((r) => r.dueDates.map((d) => ({ r, d })))
    .sort((a, b) => a.d.due.localeCompare(b.d.due));

function DueRows({ rows, side }: { rows: ReturnType<typeof dueRows>; side: Side }) {
  return (
    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
      {rows.map(({ r, d }) => {
        const { Icon, ink } = STATE[d.state];
        return (
          <li key={`${r.ruleId}-${d.due}`} className="flex items-start gap-3 px-3 py-2">
            <Icon size={14} className={`mt-1 shrink-0 ${ink}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium truncate">{r.name}</span>
                <span className="text-sm font-mono shrink-0">{fmt2(r.expectedAmt)}</span>
              </div>
              <div className="text-xs text-muted">Due {day(d.due)} · {detail(d, side)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Tile({ label, value, tone, note }: { label: string; value: string; tone: string; note?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {note && <div className="text-[10px]">{note}</div>}
    </div>
  );
}

const GREEN = 'bg-green-500/5 border-green-500/20 text-green-600';
const RED = 'bg-red-500/5 border-red-500/20 text-red-500';

function sideTiles(data: ExpectedVsActual, side: Side) {
  if (side === 'income') {
    const short = data.incomeExpected - data.incomeActual;
    return [
      <Tile key="e" label="Expected income" value={fmt(data.incomeExpected)} tone={GREEN} />,
      <Tile key="a" label="Received" value={fmt(data.incomeActual)} tone={short > 0 ? 'bg-green-500/5 border-green-500/20 text-yellow-600' : GREEN} note={short > 0 ? `${fmt(short)} still due` : undefined} />,
    ];
  }
  const left = data.expenseExpected - data.expenseActual;
  return [
    <Tile key="e" label="Expected expenses" value={fmt(data.expenseExpected)} tone={RED} />,
    <Tile key="a" label="Paid" value={fmt(data.expenseActual)} tone={left < 0 ? 'bg-red-500/5 border-red-500/20 text-orange-500' : RED} note={left > 0 ? `${fmt(left)} still expected` : undefined} />,
  ];
}

// Each pair of figures opens the due dates behind it, so a total can be traced
// to the bills or paychecks that make it up.
function SidePair({ data, side }: { data: ExpectedVsActual; side: Side }) {
  const [open, setOpen] = useState(false);
  const rows = dueRows(data.rules, side);
  const noun = side === 'income' ? 'paycheck' : 'bill';
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} disabled={rows.length === 0} className="w-full text-left">
        <div className="grid grid-cols-2 gap-3">{sideTiles(data, side)}</div>
        {rows.length > 0 && (
          <span className="mt-1 flex items-center gap-1 text-xs text-accent">
            <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {open ? 'Hide' : 'Show'} {rows.length} {rows.length === 1 ? noun : `${noun}s`}
          </span>
        )}
      </button>
      {open && <DueRows rows={rows} side={side} />}
    </div>
  );
}

export function ExpectedVsReceived({ data, monthLabel }: { data: ExpectedVsActual; monthLabel: string }) {
  if (data.incomeExpected <= 0 && data.expenseExpected <= 0) return null;
  return (
    <Section id="expected" title="Expected vs received" icon={<BarChart3 size={14} className="text-accent" />} right={<span className="text-xs text-muted shrink-0">{monthLabel}</span>}>
      <div className="space-y-4">
        <SidePair data={data} side="income" />
        <SidePair data={data} side="expense" />
      </div>
    </Section>
  );
}
