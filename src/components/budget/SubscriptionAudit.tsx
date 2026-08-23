'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ArrowLeft, TrendingUp, TrendingDown, Repeat } from 'lucide-react';
import { CancelEmailModal } from './CancelEmailModal';

type SubscriptionRow = {
  vendor: string;
  category: string;
  frequency: string;
  occurrences: number;
  confidence: number;
  avgAmount: number;
  monthlyEstimate: number;
  annualCost: number;
  minAmount: number;
  maxAmount: number;
  firstAmount: number;
  latestAmount: number;
  priceChangePercent: number;
  lastDate: string;
};

type Payload = { subscriptions: SubscriptionRow[]; totalAnnual: number; totalMonthly: number };

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
};

// A price change worth surfacing — smaller wobble is just rounding/tax noise.
const PRICE_FLAG_THRESHOLD = 5;

export function SubscriptionAudit() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<SubscriptionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/budget/subscriptions');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? 'Could not load subscriptions');
      else setData(json);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-12">
      <Link href="/budget" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-4">
        <ArrowLeft size={15} /> Back to budget
      </Link>

      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        <Repeat size={22} className="text-accent" /> Subscription audit
      </h1>
      <p className="text-muted mb-6 text-sm">
        Recurring charges detected from your transaction history, ranked by yearly cost.
      </p>

      {loading && (
        <div className="flex items-center justify-center h-40 gap-3 text-muted">
          <Loader2 size={22} className="animate-spin text-accent" />
          <span className="text-sm">Scanning transactions…</span>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && data && data.subscriptions.length === 0 && (
        <p className="text-sm text-muted">
          No recurring charges detected yet. Import a few months of statements from the budget page and
          check back — three or more regular charges from the same vendor are needed to spot a pattern.
        </p>
      )}

      {!loading && !error && data && data.subscriptions.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl border border-border p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Estimated yearly</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{money(data.totalAnnual)}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Per month</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{money(data.totalMonthly)}</div>
            </div>
          </div>

          <ul className="space-y-2">
            {data.subscriptions.map((s) => {
              const flagged = Math.abs(s.priceChangePercent) >= PRICE_FLAG_THRESHOLD;
              const up = s.priceChangePercent > 0;
              return (
                <li
                  key={s.vendor}
                  className="rounded-xl border border-border p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{s.vendor}</div>
                    <div className="text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span>{FREQ_LABEL[s.frequency] ?? s.frequency}</span>
                      <span aria-hidden>·</span>
                      <span>{s.category}</span>
                      <span aria-hidden>·</span>
                      <span>{money(s.avgAmount)}/charge</span>
                      {flagged && (
                        <span
                          className={`inline-flex items-center gap-0.5 font-medium ${
                            up ? 'text-red-500' : 'text-green-600'
                          }`}
                          title={`Was ${money(s.firstAmount)}, now ${money(s.latestAmount)}`}
                        >
                          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {up ? '+' : ''}
                          {s.priceChangePercent}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{money(s.annualCost)}<span className="text-xs text-muted font-normal">/yr</span></div>
                    <div className="text-xs text-muted tabular-nums">{money(s.monthlyEstimate)}/mo</div>
                  </div>
                  <button
                    onClick={() => setCancelTarget(s)}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-surface transition-colors shrink-0"
                  >
                    Cancel…
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {cancelTarget && (
        <CancelEmailModal
          vendor={cancelTarget.vendor}
          monthlyAmount={cancelTarget.monthlyEstimate}
          lastChargeDate={cancelTarget.lastDate}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
