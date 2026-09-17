'use client';
import { AlertTriangle } from 'lucide-react';
import type { OverdueBill } from '@/lib/budgetExpected';

const money = (n: number) => `$${n.toFixed(2)}`;
const lateLabel = (days: number) => (days === 1 ? '1 day late' : `${days} days late`);

export function OverdueBills({ bills }: { bills?: OverdueBill[] }) {
  if (!bills || bills.length === 0) return null;
  const total = bills.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={13} className="text-red-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-red-500">Overdue bills</span>
        <span className="text-xs text-muted">({bills.length})</span>
        <span className="ml-auto text-sm font-mono text-red-500">-{money(total)}</span>
      </div>
      <div className="space-y-1.5">
        {bills.map((b) => (
          <div key={`${b.ruleId}-${b.dueDate}`} className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-surface px-3 py-2">
            <span className="w-1 h-7 rounded-full bg-red-500" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{b.name}</div>
              <div className="text-xs text-muted">Due {b.dueDate} · {lateLabel(b.daysOverdue)} · {b.category}</div>
            </div>
            <div className="text-sm font-mono text-red-500">-{money(b.amount)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        No payment for these due dates appears in the ledger. The bill clears once the payment shows up in an import or you add it by hand.
      </p>
    </div>
  );
}
