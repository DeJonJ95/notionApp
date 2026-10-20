'use client';
import { AlertTriangle, Clock } from 'lucide-react';
import type { OverdueBill } from '@/lib/budgetExpected';

const money = (n: number) => `$${n.toFixed(2)}`;
const dayCount = (days: number) => (days === 1 ? '1 day' : `${days} days`);

const GROUPS = {
  overdue: {
    title: 'Overdue bills',
    Icon: AlertTriangle,
    box: 'border-red-500/40 bg-red-500/5',
    row: 'border-red-500/20',
    bar: 'bg-red-500',
    ink: 'text-red-500',
    when: (days: number) => `${dayCount(days)} late`,
    note: 'No payment for these due dates appears in the ledger. The bill clears once the payment shows up in an import or you add it by hand.',
  },
  unconfirmed: {
    title: 'Not confirmed yet',
    Icon: Clock,
    box: 'border-yellow-500/40 bg-yellow-500/5',
    row: 'border-yellow-500/20',
    bar: 'bg-yellow-500',
    ink: 'text-yellow-600',
    when: (days: number) => `due ${dayCount(days)} ago`,
    note: 'No imported statement reaches these due dates yet, so they count as unpaid. Each clears once the payment shows up in an import or you add it by hand.',
  },
};

function BillGroup({ bills, kind }: { bills: OverdueBill[]; kind: keyof typeof GROUPS }) {
  if (bills.length === 0) return null;
  const g = GROUPS[kind];
  const total = bills.reduce((s, b) => s + b.amount, 0);

  return (
    <div className={`rounded-xl border p-4 ${g.box}`}>
      <div className="flex items-center gap-2 mb-2">
        <g.Icon size={13} className={g.ink} />
        <h2 className={`text-base font-semibold ${g.ink}`}>{g.title}</h2>
        <span className="text-xs text-muted">({bills.length})</span>
        <span className={`ml-auto text-sm font-mono ${g.ink}`}>-{money(total)}</span>
      </div>
      <div className="space-y-1.5">
        {bills.map((b) => (
          <div key={`${b.ruleId}-${b.dueDate}`} className={`flex items-center gap-3 rounded-lg border bg-surface px-3 py-2 ${g.row}`}>
            <span className={`w-1 h-7 rounded-full ${g.bar}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{b.name}</div>
              <div className="text-xs text-muted">Due {b.dueDate} · {g.when(b.daysOverdue)} · {b.category}</div>
            </div>
            <div className={`text-sm font-mono ${g.ink}`}>-{money(b.amount)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">{g.note}</p>
    </div>
  );
}

export function OverdueBills({ bills = [] }: { bills?: OverdueBill[] }) {
  return (
    <>
      <BillGroup bills={bills.filter((b) => b.state === 'overdue')} kind="overdue" />
      <BillGroup bills={bills.filter((b) => b.state === 'unconfirmed')} kind="unconfirmed" />
    </>
  );
}
