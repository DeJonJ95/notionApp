'use client';
import { AlertTriangle, BarChart3, CheckCircle2, Clock } from 'lucide-react';
import type { ExpectedVsActual, RuleMatch } from '@/lib/budgetExpected';
import { Section } from './Section';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const TONE = {
  paid: 'border-green-500/30 bg-green-500/5 text-green-700',
  waiting: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-700',
  missing: 'border-red-500/30 bg-red-500/5 text-red-600',
};

// A due date with only a forecast row is waiting on a statement, never paid.
function RuleChip({ r }: { r: RuleMatch }) {
  const paid = r.matchedCount >= r.expectedCount;
  const waiting = !paid && (r.matchedCount > 0 || r.unconfirmedCount > 0);
  const Icon = paid ? CheckCircle2 : waiting ? Clock : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${TONE[paid ? 'paid' : waiting ? 'waiting' : 'missing']}`}
      title={r.unconfirmedCount > 0 ? 'Due date passed; no imported statement reaches it yet' : undefined}
    >
      <Icon size={10} />
      {r.name} <span className="opacity-70">({r.matchedCount}/{r.expectedCount})</span>
      {r.unconfirmedCount > 0 && <span>· {r.unconfirmedCount} not confirmed</span>}
    </span>
  );
}

export function ExpectedVsReceived({ data, monthLabel }: { data: ExpectedVsActual; monthLabel: string }) {
  if (data.incomeExpected <= 0 && data.expenseExpected <= 0) return null;
  return (
    <Section id="expected" title="Expected vs received" icon={<BarChart3 size={14} className="text-accent" />} right={<span className="text-xs text-muted shrink-0">{monthLabel}</span>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2">
          <div className="text-[10px] text-muted uppercase tracking-wide">Expected income</div>
          <div className="text-lg font-bold text-green-600">{fmt(data.incomeExpected)}</div>
        </div>
        <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2">
          <div className="text-[10px] text-muted uppercase tracking-wide">Received</div>
          <div className={`text-lg font-bold ${data.incomeActual >= data.incomeExpected ? 'text-green-600' : 'text-yellow-600'}`}>
            {fmt(data.incomeActual)}
          </div>
          {data.incomeActual < data.incomeExpected && (
            <div className="text-[10px] text-yellow-600">{fmt(data.incomeExpected - data.incomeActual)} still due</div>
          )}
        </div>
        <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
          <div className="text-[10px] text-muted uppercase tracking-wide">Expected expenses</div>
          <div className="text-lg font-bold text-red-500">{fmt(data.expenseExpected)}</div>
        </div>
        <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
          <div className="text-[10px] text-muted uppercase tracking-wide">Paid</div>
          <div className={`text-lg font-bold ${data.expenseActual <= data.expenseExpected ? 'text-red-500' : 'text-orange-500'}`}>
            {fmt(data.expenseActual)}
          </div>
          {data.expenseActual < data.expenseExpected && (
            <div className="text-[10px] text-muted">{fmt(data.expenseExpected - data.expenseActual)} still expected</div>
          )}
        </div>
      </div>
      {data.rules.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.rules.map((r) => <RuleChip key={r.ruleId} r={r} />)}
        </div>
      )}
    </Section>
  );
}
