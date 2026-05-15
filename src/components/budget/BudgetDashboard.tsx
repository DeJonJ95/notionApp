'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload, TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  Mail, RefreshCw, ExternalLink, Loader2,
} from 'lucide-react';
import { ImportStatementModal } from './ImportStatementModal';
import { CancelEmailModal } from './CancelEmailModal';
import type { DashboardPayload, Subscription } from '@/app/api/budget/dashboard/route';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export function BudgetDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/budget/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-muted">
        <p>Couldn&apos;t load budget data.</p>
        <button onClick={load} className="mt-3 text-sm text-accent hover:underline">Try again</button>
      </div>
    );
  }

  const empty = data.recentTransactions.length === 0;
  const netClr = data.net >= 0 ? 'text-green-600' : 'text-red-500';
  const netBg = data.net >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5';
  const netDelta = data.net - data.prevMonth.net;
  const incDelta = data.income - data.prevMonth.income;
  const expDelta = data.expenses - data.prevMonth.expenses;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6">
      {importOpen && (
        <ImportStatementModal onClose={() => setImportOpen(false)} onImported={load} />
      )}
      {cancelTarget && (
        <CancelEmailModal
          vendor={cancelTarget.vendor}
          monthlyAmount={cancelTarget.monthlyEstimate}
          lastChargeDate={cancelTarget.lastDate}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <p className="text-xs text-muted mt-0.5">
            {data.monthLabel} · saving to{' '}
            <Link href={`/database/${data.databaseId}`} className="text-accent hover:underline">
              {data.databaseName}
            </Link>
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={load}
          className="p-2 rounded-lg border border-border text-muted hover:bg-surface"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80"
        >
          <Upload size={14} /> Import statement
        </button>
      </div>

      {/* Cashflow cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          label="Income"
          value={fmt(data.income)}
          delta={incDelta}
          icon={<TrendingUp size={14} className="text-green-600" />}
        />
        <StatCard
          label="Expenses"
          value={fmt(data.expenses)}
          delta={expDelta}
          deltaInvert
          icon={<TrendingDown size={14} className="text-red-500" />}
        />
        <div className={`rounded-xl border p-4 ${netBg}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted uppercase tracking-wide">Net cash flow</span>
            <DollarSign size={14} className={netClr} />
          </div>
          <div className={`text-2xl font-bold ${netClr}`}>{fmt(data.net)}</div>
          <div className="text-[11px] text-muted mt-1">
            {netDelta === 0 ? 'No change' : `${netDelta >= 0 ? '+' : ''}${fmt(netDelta)} vs last month`}
          </div>
        </div>
      </div>

      {empty && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-sm font-medium mb-1">No transactions yet</p>
          <p className="text-xs text-muted mb-4">
            Upload a bank statement (PDF or CSV) — DeepSeek will parse, categorize, and let you review before saving.
          </p>
          <button
            onClick={() => setImportOpen(true)}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent/80"
          >
            Import your first statement
          </button>
        </div>
      )}

      {/* Excesses */}
      {data.excesses.length > 0 && (
        <Section title="Spending excesses" icon={<AlertTriangle size={14} className="text-yellow-500" />}>
          <div className="space-y-2">
            {data.excesses.map((e) => (
              <div key={e.category} className="flex items-center justify-between rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{e.category}</div>
                  <div className="text-xs text-muted">
                    {fmt(e.spent)} this month · {e.vsPrior > 0 ? '+' : ''}{fmt(e.vsPrior)} vs last month
                  </div>
                </div>
                <div className="text-sm font-semibold text-yellow-600">
                  +{Math.round(e.pctChange)}%
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Category breakdown */}
      {data.byCategory.length > 0 && (
        <Section title="Where the money went" icon={null}>
          <div className="space-y-1.5">
            {data.byCategory.map((c) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="font-medium">{c.category}</span>
                  <span className="text-muted">{fmt(c.spent)} · {c.pct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-bg rounded-full overflow-hidden border border-border/40">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Subscriptions / recurring */}
      {data.subscriptions.length > 0 && (
        <Section title="Recurring charges" icon={<RefreshCw size={13} className="text-accent" />}>
          <p className="text-xs text-muted mb-2">
            Detected by repeated charges from the same vendor. Tap the email icon to draft a cancellation.
          </p>
          <div className="space-y-1">
            {data.subscriptions.map((s) => (
              <div key={s.vendor} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.vendor}</div>
                  <div className="text-xs text-muted">
                    ~{fmt2(s.monthlyEstimate)}/mo · {s.occurrences} charges · last {s.lastDate} · {s.category}
                  </div>
                </div>
                <button
                  onClick={() => setCancelTarget(s)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-bg text-muted hover:text-text"
                  title="Draft cancellation email"
                >
                  <Mail size={12} /> Cancel
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Recent transactions */}
      {data.recentTransactions.length > 0 && (
        <Section
          title="Recent transactions"
          icon={null}
          right={
            <Link href={`/database/${data.databaseId}`} className="text-xs text-muted hover:text-accent flex items-center gap-1">
              View all <ExternalLink size={11} />
            </Link>
          }
        >
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-24">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Vendor</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((t) => (
                  <tr key={t.pageId} className="border-t border-border/40">
                    <td className="px-3 py-1.5 text-xs text-muted">{t.date}</td>
                    <td className="px-3 py-1.5 truncate max-w-[200px]">{t.vendor}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className="inline-block px-1.5 py-0.5 bg-bg border border-border/50 rounded">
                        {t.category}
                      </span>
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function StatCard({
  label, value, delta, deltaInvert, icon,
}: {
  label: string;
  value: string;
  delta: number;
  deltaInvert?: boolean;
  icon: React.ReactNode;
}) {
  // For expenses we invert the sign — going DOWN is good.
  const positive = deltaInvert ? delta < 0 : delta > 0;
  const negative = deltaInvert ? delta > 0 : delta < 0;
  const cls = positive ? 'text-green-600' : negative ? 'text-red-500' : 'text-muted';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className={`text-[11px] mt-1 ${cls}`}>
        {delta === 0 ? 'No change' : `${sign}${fmt(Math.abs(delta))} vs last month`}
      </div>
    </div>
  );
}

function Section({
  title, icon, right, children,
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  );
}
