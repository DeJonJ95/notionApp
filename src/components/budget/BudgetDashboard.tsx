'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload, TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  Mail, RefreshCw, ExternalLink, Loader2, Calendar, Repeat, Sparkles,
  Target, Tag, BarChart3, Layers, Clock, CheckCircle2, Zap, X, CreditCard, Wallet,
  Landmark, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ImportStatementModal } from './ImportStatementModal';
import { CancelEmailModal } from './CancelEmailModal';
import { RecurringRulesModal } from './RecurringRulesModal';
import { SavingsGoalsModal } from './SavingsGoalsModal';
import { CategoryBudgetsModal } from './CategoryBudgetsModal';
import { CategorizationRulesModal } from './CategorizationRulesModal';
import { ImportReminderBanner } from './ImportReminderBanner';
import type { DashboardPayload, Subscription } from '@/app/api/budget/dashboard/route';
import type { ImportsPayload } from '@/app/api/budget/imports/route';
import type { ReconciliationPayload } from '@/app/api/budget/reconciliation/route';
import type { PatternSuggestion } from '@/lib/budgetDb';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const fmtDay = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// Shift a YYYY-MM string by whole months.
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function BudgetDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recurringPrefill, setRecurringPrefill] = useState<{ name: string; amount: number; category: string; type?: 'income' | 'expense' } | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [budgetFocusCategory, setBudgetFocusCategory] = useState<string | null>(null);
  // null = let the server pick (current month, or the latest month with data)
  const [month, setMonth] = useState<string | null>(null);

  // Feature 1: Import coverage
  const [importsData, setImportsData] = useState<ImportsPayload | null>(null);

  // Feature 3: Reconciliation
  const [reconciliation, setReconciliation] = useState<ReconciliationPayload | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  // Which import chip is currently being reconciled, so only it spins.
  const [reconTarget, setReconTarget] = useState<string | null>(null);

  const runReconciliation = useCallback(async (from: string, to: string, importId: string) => {
    setReconTarget(importId);
    setReconLoading(true);
    try {
      const res = await fetch(`/api/budget/reconciliation?from=${from}&to=${to}`);
      if (res.ok) setReconciliation(await res.json());
    } finally {
      setReconLoading(false);
      setReconTarget(null);
    }
  }, []);

  // Feature 5: Pattern suggestions (from dashboard payload)

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/budget/dashboard${month ? `?month=${month}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    // Also load imports data for coverage + reminder
    fetch('/api/budget/imports')
      .then((r) => (r.ok ? r.json() : null))
      .then(setImportsData)
      .catch(() => {});
  }, [month]);

  useEffect(() => { load(); }, [load]);

  // Full-page spinner only on the very first load — switching months keeps the
  // current view on screen (dimmed) so the header controls don't jump.
  if (loading && !data) {
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
    <div className={`max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
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
      {recurringOpen && (
        <RecurringRulesModal
          prefill={recurringPrefill ?? undefined}
          categories={data.categoryOptions}
          onChanged={load}
          onClose={() => { setRecurringOpen(false); setRecurringPrefill(null); }}
        />
      )}
      {goalsOpen && (
        <SavingsGoalsModal onChanged={load} onClose={() => setGoalsOpen(false)} />
      )}
      {rulesOpen && (
        <CategorizationRulesModal categories={data.categoryOptions} onClose={() => setRulesOpen(false)} />
      )}
      {budgetsOpen && (
        <CategoryBudgetsModal
          categoryOptions={data.categoryOptions ?? []}
          focusCategory={budgetFocusCategory}
          onChanged={load}
          onClose={() => { setBudgetsOpen(false); setBudgetFocusCategory(null); }}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() => setMonth(shiftMonth(data.month, -1))}
              className="p-2 rounded-lg border border-border text-muted hover:bg-surface hover:text-text"
              title="Previous month"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-medium min-w-[8.5rem] text-center">{data.monthLabel}</span>
            <button
              onClick={() => setMonth(shiftMonth(data.month, 1))}
              disabled={data.month >= data.currentMonth}
              className="p-2 rounded-lg border border-border text-muted hover:bg-surface hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
              title="Next month"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
            {data.month !== data.currentMonth && (
              <button
                onClick={() => setMonth(null)}
                className="ml-1 px-2 py-2 rounded-lg text-xs text-accent hover:bg-surface"
              >
                Today
              </button>
            )}
          </div>
          <p className="text-xs text-muted mt-1">
            saving to{' '}
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
          onClick={() => { setBudgetFocusCategory(null); setBudgetsOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
          title="Set monthly budgets per category"
        >
          <Wallet size={14} /> Budgets
        </button>
        <button
          onClick={() => setGoalsOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
          title="Savings goals"
        >
          <Target size={14} /> Goals
        </button>
        <button
          onClick={() => setRulesOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
          title="Categorization rules"
        >
          <Tag size={14} /> Rules
        </button>
        <button
          onClick={() => { setRecurringPrefill(null); setRecurringOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
          title="Set up recurring paychecks & bills"
        >
          <Repeat size={14} /> Recurring
        </button>
        <Link
          href="/budget/subscriptions"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
          title="Audit recurring subscriptions by yearly cost"
        >
          <CreditCard size={14} /> Subscriptions
        </Link>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80"
        >
          <Upload size={14} /> Import statement
        </button>
      </div>

      {/* Feature 6: Import reminder banner */}
      <ImportReminderBanner
        daysSinceLastImport={importsData?.daysSinceLastImport ?? null}
        onImport={() => setImportOpen(true)}
      />

      {/* Headline warning: the projected balance dips below zero */}
      {data.negativeBalanceDate && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-600">
              Balance projected to go negative on {fmtDay(data.negativeBalanceDate)}
            </p>
            <p className="text-xs text-muted mt-0.5">
              Starting from {fmt2(data.totalBalance)} across your accounts, then applying scheduled
              income and bills. Move a bill or add income before then to stay clear.
            </p>
          </div>
        </div>
      )}

      {/* Feature 3: Reconciliation button + results */}
      {importsData && importsData.imports.length > 0 && (
        <>
          {reconciliation && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={14} className="text-accent" />
                <span className="text-sm font-medium">Reconciliation: {reconciliation.dateFrom} → {reconciliation.dateTo}</span>
                <button
                  onClick={() => setReconciliation(null)}
                  className="ml-auto p-0.5 rounded text-muted hover:text-text"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="text-xs">
                  <span className="text-green-600 font-medium">{reconciliation.result.matched.length} matched</span>
                  <span className="text-muted ml-1">expected</span>
                </div>
                {reconciliation.result.missing.length > 0 && (
                  <div className="text-xs">
                    <span className="text-red-500 font-medium">{reconciliation.result.missing.length} missing</span>
                  </div>
                )}
                {reconciliation.result.unexpected.length > 0 && (
                  <div className="text-xs">
                    <span className="text-yellow-500 font-medium">{reconciliation.result.unexpected.length} unexpected</span>
                  </div>
                )}
              </div>
              {reconciliation.result.missing.length > 0 && (
                <div className="mt-2 space-y-1">
                  {reconciliation.result.missing.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-muted bg-bg rounded px-2 py-1">
                      <AlertTriangle size={10} className="text-red-500 shrink-0" />
                      <span className="truncate">{m.ruleName}</span>
                      <span className="shrink-0">· due {m.dueDate} · {fmt2(m.expectedAmount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => {
              const latest = importsData.imports[0];
              if (latest) runReconciliation(latest.dateFrom, latest.dateTo, latest.id);
            }}
            disabled={reconLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface text-muted hover:text-text transition-colors"
          >
            {reconLoading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            {reconLoading ? 'Reconciling…' : 'Reconcile last import'}
          </button>
        </>
      )}

      {data.generatedThisLoad > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm flex items-center gap-2">
          <Sparkles size={13} className="text-accent" />
          Auto-added <strong>{data.generatedThisLoad}</strong> recurring transaction{data.generatedThisLoad !== 1 ? 's' : ''} since your last visit.
        </div>
      )}

      {/* Feature 1: Coverage section */}
      {importsData && importsData.imports.length > 0 && (
        <Section title="Coverage" icon={<Layers size={13} className="text-accent" />}>
          <div className="space-y-2">
            {/* Timeline of imports */}
            <div className="flex flex-wrap gap-2">
              {importsData.imports.slice(0, 10).map((imp) => (
                <button
                  key={imp.id}
                  onClick={() => runReconciliation(imp.dateFrom, imp.dateTo, imp.id)}
                  disabled={reconLoading}
                  className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-left hover:border-accent/50 hover:bg-bg disabled:opacity-60"
                  title={`${imp.filename}: ${imp.txCount} transactions. Tap to reconcile this range.`}
                >
                  <span className="text-muted">{imp.dateFrom}</span>
                  <span className="text-muted mx-1">→</span>
                  <span className="text-muted">{imp.dateTo}</span>
                  <span className="ml-1.5 text-accent">{imp.txCount} tx</span>
                  {reconTarget === imp.id && (
                    <Loader2 size={10} className="inline animate-spin ml-1.5 text-accent" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Tap an import to reconcile that date range.</p>
            {/* Gaps */}
            {importsData.gaps.length > 0 && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <p className="text-xs font-medium text-yellow-700 mb-1">
                  Coverage gaps
                </p>
                <div className="space-y-1">
                  {importsData.gaps.map((g, idx) => (
                    <p key={idx} className="text-xs text-muted">
                      Missing {g.from} → {g.to} ({g.days} days)
                    </p>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted">
              Last import: {importsData.lastImportDate ?? 'Never'} ({importsData.daysSinceLastImport != null ? `${importsData.daysSinceLastImport} days ago` : 'N/A'})
            </p>
          </div>
        </Section>
      )}

      {/* Cashflow cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            <span className="text-xs text-muted uppercase tracking-wide">Net</span>
            <DollarSign size={14} className={netClr} />
          </div>
          <div className={`text-2xl font-bold ${netClr}`}>{fmt(data.net)}</div>
          <div className="text-[11px] text-muted mt-1">
            {netDelta === 0 ? 'No change' : `${netDelta >= 0 ? '+' : ''}${fmt(netDelta)} vs last month`}
          </div>
        </div>
        {/* Projected month-end */}
        <div className={`rounded-xl border p-4 ${data.projectedMonthEnd >= 0 ? 'border-blue-500/30 bg-blue-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted uppercase tracking-wide">Projected EoM</span>
            <Calendar size={14} className={data.projectedMonthEnd >= 0 ? 'text-blue-500' : 'text-red-500'} />
          </div>
          <div className={`text-2xl font-bold ${data.projectedMonthEnd >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
            {fmt(data.projectedMonthEnd)}
          </div>
          <div className="text-[11px] text-muted mt-1">
            Current + scheduled
          </div>
        </div>
      </div>

      {/* Accounts — balances anchored on the latest statement per account */}
      {data.accounts && data.accounts.length > 0 && (
        <Section
          title="Accounts"
          icon={<Landmark size={13} className="text-accent" />}
          right={
            data.hasBalances ? (
              <span className="text-xs text-muted">Total {fmt2(data.totalBalance)}</span>
            ) : null
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.accounts.map((a) => (
              <div key={a.account} className="rounded-xl border border-border bg-surface p-3">
                <div className="text-xs text-muted truncate" title={a.account}>{a.account}</div>
                {a.balance != null ? (
                  <>
                    <div className={`text-xl font-bold ${a.balance >= 0 ? '' : 'text-red-500'}`}>
                      {fmt2(a.balance)}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      Statement {a.asOf}
                      {a.sinceStatement !== 0 && (
                        <> · {a.sinceStatement > 0 ? '+' : '−'}{fmt2(Math.abs(a.sinceStatement))} since</>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-bold text-muted">—</div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {a.txCount} tx · no statement balance yet
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {!data.hasBalances && (
            <p className="text-xs text-muted mt-2">
              Import a statement that shows a closing balance to project your balance forward.
            </p>
          )}
        </Section>
      )}

      {/* Projected balance curve — next 45 days */}
      {data.hasBalances && data.balanceCurve.length > 1 && (
        <Section
          title="Projected balance — next 45 days"
          icon={<TrendingDown size={13} className={data.negativeBalanceDate ? 'text-red-500' : 'text-accent'} />}
        >
          {(() => {
            const pts = data.balanceCurve;
            const values = pts.map((p) => p.balance);
            const min = Math.min(0, ...values);
            const max = Math.max(0, ...values);
            const span = max - min || 1;
            const W = 600;
            const H = 140;
            const PAD = 8;
            const px = (i: number) => (i / (pts.length - 1)) * W;
            const py = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
            const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.balance).toFixed(1)}`).join(' ');
            const area = `${line} L${W},${(H - PAD).toFixed(1)} L0,${(H - PAD).toFixed(1)} Z`;
            const zeroY = py(0);
            const tone = data.negativeBalanceDate ? 'text-red-500' : 'text-accent';
            const low = pts.reduce((lo, p) => (p.balance < lo.balance ? p : lo), pts[0]);
            return (
              <div className="rounded-xl border border-border bg-surface p-3">
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`w-full h-36 ${tone}`}>
                  <path d={area} fill="currentColor" opacity={0.12} />
                  {min < 0 && (
                    <line
                      x1="0" x2={W} y1={zeroY} y2={zeroY}
                      stroke="currentColor" strokeDasharray="4 4" opacity={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path d={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="flex items-center justify-between text-[11px] text-muted mt-1">
                  <span>{pts[0].date}</span>
                  <span>
                    Low {fmt2(low.balance)} on {low.date}
                  </span>
                  <span>{pts[pts.length - 1].date}</span>
                </div>
              </div>
            );
          })()}
        </Section>
      )}

      {/* Expected vs Actual — income/expense from recurring rules compared to what's been imported */}
      {data.expectedVsActual && (data.expectedVsActual.incomeExpected > 0 || data.expectedVsActual.expenseExpected > 0) && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={13} className="text-accent" />
            <span className="text-xs font-semibold uppercase tracking-wide">Expected vs received — {data.monthLabel}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide">Expected income</div>
              <div className="text-lg font-bold text-green-600">{fmt(data.expectedVsActual.incomeExpected)}</div>
            </div>
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide">Received</div>
              <div className={`text-lg font-bold ${data.expectedVsActual.incomeActual >= data.expectedVsActual.incomeExpected ? 'text-green-600' : 'text-yellow-600'}`}>
                {fmt(data.expectedVsActual.incomeActual)}
              </div>
              {data.expectedVsActual.incomeActual < data.expectedVsActual.incomeExpected && (
                <div className="text-[10px] text-yellow-600">
                  {fmt(data.expectedVsActual.incomeExpected - data.expectedVsActual.incomeActual)} still due
                </div>
              )}
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide">Expected expenses</div>
              <div className="text-lg font-bold text-red-500">{fmt(data.expectedVsActual.expenseExpected)}</div>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide">Posted</div>
              <div className={`text-lg font-bold ${data.expectedVsActual.expenseActual <= data.expectedVsActual.expenseExpected ? 'text-red-500' : 'text-orange-500'}`}>
                {fmt(data.expectedVsActual.expenseActual)}
              </div>
              {data.expectedVsActual.expenseActual < data.expectedVsActual.expenseExpected && (
                <div className="text-[10px] text-muted">
                  {fmt(data.expectedVsActual.expenseExpected - data.expectedVsActual.expenseActual)} still expected
                </div>
              )}
            </div>
          </div>
          {/* Per-rule mini breakdown */}
          {data.expectedVsActual.rules.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.expectedVsActual.rules.map((r) => {
                const pct = r.expectedCount > 0 ? Math.round((r.matchedCount / r.expectedCount) * 100) : 0;
                const allMatched = pct >= 100;
                return (
                  <span
                    key={r.ruleId}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                      allMatched
                        ? 'border-green-500/30 bg-green-500/5 text-green-700'
                        : r.matchedCount > 0
                          ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-700'
                          : 'border-red-500/30 bg-red-500/5 text-red-600'
                    }`}
                  >
                    {allMatched ? <CheckCircle2 size={10} /> : r.matchedCount > 0 ? <Clock size={10} /> : <AlertTriangle size={10} />}
                    {r.name} <span className="opacity-70">({r.matchedCount}/{r.expectedCount})</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Auto-budget overview */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={14} className="text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">
            {data.autoBudget.hasManualBudget ? 'Budget' : 'Auto-budget'}
          </span>
          {data.autoBudget.hasManualBudget ? (
            <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-medium">Manual</span>
          ) : (
            <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded font-medium">Auto</span>
          )}
          <div className="flex-1" />
          <Link href={`/database/${data.databaseId}`} className="text-xs text-muted hover:text-accent flex items-center gap-1">
            Budget summary <ExternalLink size={10} />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-muted uppercase tracking-wide mb-0.5">Projected income</div>
            <div className="text-lg font-bold text-green-600">{fmt(data.autoBudget.monthlyProjectedIncome)}</div>
            <div className="text-[10px] text-muted">/mo from recurring rules</div>
          </div>
          <div>
            <div className="text-xs text-muted uppercase tracking-wide mb-0.5">Projected expenses</div>
            <div className="text-lg font-bold text-red-500">{fmt(data.autoBudget.monthlyProjectedExpenses)}</div>
            <div className="text-[10px] text-muted">/mo from recurring rules</div>
          </div>
          <div>
            <div className="text-xs text-muted uppercase tracking-wide mb-0.5">Savings goals</div>
            <div className="text-lg font-bold text-blue-600">{fmt(data.autoBudget.monthlySavingsTotal)}</div>
            <div className="text-[10px] text-muted">
              {data.autoBudget.monthlySavingsTotal > 0 ? 'Needed /mo to hit goals' : 'No goals set'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted uppercase tracking-wide mb-0.5">Available to budget</div>
            <div className={`text-lg font-bold ${data.autoBudget.availableToBudget > 0 ? 'text-green-600' : 'text-muted'}`}>
              {fmt(data.autoBudget.availableToBudget)}
            </div>
            <div className="text-[10px] text-muted">
              {data.autoBudget.hasManualBudget
                ? 'Manual budgets set'
                : data.autoBudget.monthlyProjectedIncome > 0
                  ? 'Income − savings (auto)'
                  : 'Set up recurring income'}
            </div>
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

      {/* Forecast — next 14 days of scheduled income/expense */}
      {data.forecast.length > 0 && (
        <Section title="Coming up — next 14 days" icon={<Calendar size={13} className="text-blue-500" />}>
          <div className="space-y-1.5">
            {data.forecast.map((f, idx) => (
              <div key={`${f.ruleId}-${idx}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <span className={`w-1 h-7 rounded-full ${f.amount >= 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted">{f.date} · {f.category}</div>
                </div>
                <div className={`text-sm font-mono ${f.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {f.amount >= 0 ? '+' : '-'}${Math.abs(f.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </Section>
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

      {/* Spending trends — last 6 months, income vs expenses */}
      {data.trends && data.trends.some((t) => t.income || t.expenses) && (
        <Section title="Trends — last 6 months" icon={<BarChart3 size={13} className="text-accent" />}>
          {(() => {
            const max = Math.max(
              1,
              ...data.trends.map((t) => Math.max(t.income, t.expenses))
            );
            return (
              <div className="flex items-end justify-between gap-2 h-40 px-1">
                {data.trends.map((t) => (
                  <div key={t.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="w-full flex items-end justify-center gap-1 h-full">
                      <div
                        className="w-1/2 bg-green-500/70 rounded-t hover:bg-green-500 transition-colors"
                        style={{ height: `${(t.income / max) * 100}%` }}
                        title={`Income ${fmt(t.income)}`}
                      />
                      <div
                        className="w-1/2 bg-red-500/70 rounded-t hover:bg-red-500 transition-colors"
                        style={{ height: `${(t.expenses / max) * 100}%` }}
                        title={`Expenses ${fmt(t.expenses)}`}
                      />
                    </div>
                    <span className="text-[10px] text-muted whitespace-nowrap">{t.month}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-muted">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500/70 inline-block" /> Income</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" /> Expenses</span>
          </div>
        </Section>
      )}

      {/* Feature 5: Pattern suggestions */}
      {data.patternSuggestions && data.patternSuggestions.length > 0 && (
        <Section title="Suggested recurring" icon={<Zap size={13} className="text-accent" />}>
          <p className="text-xs text-muted mb-2">
            Detected regular patterns. Tap <strong>Track</strong> to add as a recurring rule.
          </p>
          <div className="space-y-1">
            {data.patternSuggestions.slice(0, 10).map((ps, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ps.vendor}</div>
                  <div className="text-xs text-muted">
                    {ps.type === 'income' ? '+' : '-'}${ps.averageAmount.toFixed(2)} · {ps.frequency} · {ps.occurrences}× · {(ps.confidence * 100).toFixed(0)}% confidence
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRecurringPrefill({ name: ps.vendor, amount: ps.averageAmount, category: ps.category, type: ps.type });
                    setRecurringOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-bg text-muted hover:text-text"
                >
                  <Repeat size={12} /> Track
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Feature 4: Rule variance shown in recurring section */}
      {data.ruleVariance && data.ruleVariance.length > 0 && (
        <Section title="Recurring rule variance" icon={<BarChart3 size={13} className="text-blue-500" />}>
          <p className="text-xs text-muted mb-2">
            How actual amounts compare to your recurring rule amounts.
            <Link href={`/database/${data.databaseId}`} className="text-accent hover:underline ml-1">View all</Link>
          </p>
          <div className="space-y-1">
            {data.ruleVariance.filter((rv) => rv.variance.sampleCount > 0).slice(0, 10).map((rv) => (
              <div key={rv.ruleId} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <span className={`w-1 h-8 rounded-full ${rv.type === 'income' ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{rv.name}</div>
                  <div className="text-xs text-muted">
                    Rule: ${rv.amount.toFixed(2)} · Actual avg: {fmt2(rv.variance.averageAmount)}
                    {Math.abs(rv.variance.variancePercent) > 5 && (
                      <span className={`ml-1 ${rv.variance.variancePercent > 0 ? 'text-yellow-500' : 'text-green-500'}`}>
                        ({rv.variance.variancePercent > 0 ? '+' : ''}{rv.variance.variancePercent}% off)
                      </span>
                    )}
                  </div>
                </div>
                {Math.abs(rv.variance.variancePercent) > 10 && rv.variance.sampleCount >= 2 && (
                  <button
                    onClick={() => {
                      setRecurringPrefill({ name: rv.name, amount: rv.variance.suggestedAmount, category: rv.category ?? 'Other' });
                      setRecurringOpen(true);
                    }}
                    className="text-xs px-2 py-1 rounded border border-accent/30 text-accent hover:bg-accent/5 shrink-0"
                  >
                    Update to {fmt2(rv.variance.suggestedAmount)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Budgets — per-category envelope target vs this month's spend */}
      {data.categoryBudgets && data.categoryBudgets.length > 0 && (
        <Section
          title="Budgets"
          icon={<Wallet size={13} className="text-accent" />}
          right={
            <button
              onClick={() => { setBudgetFocusCategory(null); setBudgetsOpen(true); }}
              className="text-xs text-muted hover:text-accent"
            >
              Edit budgets
            </button>
          }
        >
          {(() => {
            const budgeted = data.categoryBudgets.filter((c) => c.budgeted > 0);
            const unbudgeted = data.categoryBudgets.filter((c) => c.budgeted <= 0);
            const totalBudgeted = budgeted.reduce((s, c) => s + c.budgeted, 0);
            const totalSpent = budgeted.reduce((s, c) => s + c.spent, 0);
            const left = totalBudgeted - totalSpent;
            const elapsed = data.categoryBudgets[0]?.pctOfMonthElapsed ?? 0;
            return (
              <div className="space-y-3">
                {budgeted.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <span className="text-muted">Budgeted <strong className="text-text">{fmt(totalBudgeted)}</strong></span>
                    <span className="text-muted">Spent <strong className="text-text">{fmt(totalSpent)}</strong></span>
                    <span className={left >= 0 ? 'text-green-600' : 'text-red-500'}>
                      {left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}
                    </span>
                    <div className="flex-1" />
                    <span className="text-muted">{elapsed.toFixed(0)}% of month gone</span>
                  </div>
                )}

                {budgeted.length > 0 && (
                  <div className="space-y-2.5">
                    {budgeted.map((c) => {
                      const over = c.pctSpent > 100;
                      const barCls = over ? 'bg-red-500' : c.pctSpent > 85 ? 'bg-amber-500' : 'bg-accent';
                      return (
                        <div key={c.category}>
                          <div className="flex items-center justify-between gap-2 text-xs mb-1">
                            <span className="font-medium truncate">{c.category}</span>
                            <span className={over ? 'text-red-500' : 'text-muted'}>
                              {fmt(c.spent)} of {fmt(c.budgeted)}
                            </span>
                          </div>
                          <div className="relative h-2 bg-bg rounded-full overflow-hidden border border-border/40">
                            <div
                              className={`h-full rounded-full transition-all ${barCls}`}
                              style={{ width: `${Math.min(100, c.pctSpent)}%` }}
                            />
                            {c.pctOfMonthElapsed > 0 && c.pctOfMonthElapsed < 100 && (
                              <span
                                className="absolute top-0 bottom-0 w-px bg-text/50"
                                style={{ left: `${c.pctOfMonthElapsed}%` }}
                                title="How much of the month has passed"
                              />
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted mt-0.5">
                            <span>{c.pctSpent.toFixed(0)}% spent, {c.pctOfMonthElapsed.toFixed(0)}% of month gone</span>
                            <span className={c.remaining >= 0 ? '' : 'text-red-500'}>
                              {c.remaining >= 0 ? `${fmt2(c.remaining)} left` : `${fmt2(-c.remaining)} over`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {unbudgeted.length > 0 && (
                  <div>
                    <p className="text-xs text-muted mb-1.5">
                      {budgeted.length > 0 ? 'Spending with no budget set' : 'No budgets set yet. Pick a category to start.'}
                    </p>
                    <div className="space-y-1">
                      {unbudgeted.map((c) => (
                        <div key={c.category} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                          <span className="flex-1 min-w-0 text-sm truncate">{c.category}</span>
                          <span className="text-xs text-muted shrink-0">{fmt(c.spent)} spent</span>
                          <button
                            onClick={() => { setBudgetFocusCategory(c.category); setBudgetsOpen(true); }}
                            className="px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-bg text-muted hover:text-text shrink-0"
                          >
                            Set budget
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </Section>
      )}

      {/* Other repeat vendors — strictly: 2+ charges from same vendor in 90d
          that didn't pass the subscription heuristic (food/transport/varying
          amounts). Lets you manually flag car payments, weekly coffee shops,
          gas stations, utility bills with variable amounts, etc. */}
      {data.repeatVendors && data.repeatVendors.length > 0 && (
        <Section
          title="Other repeat vendors"
          icon={<Repeat size={13} className="text-muted" />}
        >
          <p className="text-xs text-muted mb-2">
            Vendors with 2+ charges in the last 90 days that the auto-detector skipped.
            Tap <strong>Track</strong> to make any of them recurring.
          </p>
          <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
            {data.repeatVendors.slice(0, 30).map((v) => (
              <div key={v.vendor} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{v.vendor}</div>
                  <div className="text-xs text-muted">
                    {v.occurrences}× · avg {fmt2(v.averageAmount)} · total {fmt(v.totalAmount)} · last {v.lastDate} · {v.category}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRecurringPrefill({ name: v.vendor, amount: v.averageAmount, category: v.category });
                    setRecurringOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-bg text-muted hover:text-text"
                  title="Make this a recurring expense"
                >
                  <Repeat size={12} /> Track
                </button>
              </div>
            ))}
            {data.repeatVendors.length > 30 && (
              <p className="text-xs text-muted text-center py-1">
                Showing top 30 by total spend.
              </p>
            )}
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
                  onClick={() => {
                    setRecurringPrefill({ name: s.vendor, amount: s.monthlyEstimate, category: s.category });
                    setRecurringOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-bg text-muted hover:text-text"
                  title="Turn this into a tracked recurring bill"
                >
                  <Repeat size={12} /> Track
                </button>
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
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((t) => (
                  <tr key={t.pageId} className="border-t border-border/40 group/row">
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
                    <td className="px-2 py-1">
                      <button
                        onClick={() => {
                          setRecurringPrefill({
                            name: t.vendor || 'Untitled',
                            amount: Math.abs(t.amount),
                            category: t.category,
                            type: t.amount >= 0 ? 'income' : 'expense',
                          });
                          setRecurringOpen(true);
                        }}
                        className="p-1 rounded text-muted hover:text-accent hover:bg-bg opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity"
                        title="Make this a recurring rule"
                      >
                        <Repeat size={12} />
                      </button>
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
