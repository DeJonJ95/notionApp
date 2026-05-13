'use client';
import { useState, useEffect } from 'react';
import { ExternalLink, Zap, Mail, Database, AlertCircle } from 'lucide-react';

type DayBucket = { day: string; inputTokens: number; outputTokens: number; costUsd: number };
type OpBucket = { operation: string; count: number; inputTokens: number; outputTokens: number; costUsd: number };

type UsageData = {
  period: string;
  since: string;
  deepseek: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    callCount: number;
    byOperation: OpBucket[];
    byDay: DayBucket[];
  };
  resend: { emailsSent: number; error: string | null };
};

type Period = 'today' | 'week' | 'month';

function fmt(n: number) {
  return n >= 1_000_000
    ? (n / 1_000_000).toFixed(2) + 'M'
    : n >= 1_000
    ? (n / 1_000).toFixed(1) + 'k'
    : String(n);
}

function fmtCost(n: number) {
  if (n < 0.0001) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function BarChart({ data }: { data: DayBucket[] }) {
  if (!data.length) return <p className="text-xs text-muted py-4 text-center">No data yet</p>;
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.000001);
  return (
    <div className="flex items-end gap-1 h-20">
      {data.map((d) => {
        const pct = Math.max((d.costUsd / maxCost) * 100, 2);
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group relative" title={`${d.day}: ${fmtCost(d.costUsd)}`}>
            <div
              className="w-full bg-accent/70 rounded-t group-hover:bg-accent transition-colors"
              style={{ height: `${pct}%` }}
            />
            <span className="text-[8px] text-muted rotate-45 origin-left hidden sm:block whitespace-nowrap">
              {d.day.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const PERIODS: { label: string; value: Period }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
];

const EXTERNAL = [
  { name: 'Neon', desc: 'Postgres compute & storage', href: 'https://console.neon.tech', color: 'bg-green-500/10 border-green-500/20', icon: Database },
  { name: 'Groq', desc: 'LLM inference', href: 'https://console.groq.com/usage', color: 'bg-orange-500/10 border-orange-500/20', icon: Zap },
];

export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/usage?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usage Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">API costs & activity across your tools</p>
        </div>
        <div className="flex gap-1 bg-bg border border-border rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                period === p.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-muted py-10 text-center">Loading…</div>}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* DeepSeek card */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Zap size={14} className="text-blue-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">DeepSeek</p>
                <p className="text-xs text-muted">AI extraction & note organizing</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xl font-bold text-accent">{fmtCost(data.deepseek.totalCostUsd)}</p>
                <p className="text-xs text-muted">{data.deepseek.callCount} call{data.deepseek.callCount !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Token stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Input tokens', value: fmt(data.deepseek.totalInputTokens) },
                  { label: 'Output tokens', value: fmt(data.deepseek.totalOutputTokens) },
                  { label: 'Total tokens', value: fmt(data.deepseek.totalInputTokens + data.deepseek.totalOutputTokens) },
                  { label: 'Total cost', value: fmtCost(data.deepseek.totalCostUsd) },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-bg border border-border px-3 py-2.5">
                    <p className="text-xs text-muted mb-0.5">{s.label}</p>
                    <p className="font-semibold text-sm">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* By operation */}
              {data.deepseek.byOperation.length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-wide font-medium mb-2">By operation</p>
                  <div className="space-y-1">
                    {data.deepseek.byOperation.map((op) => (
                      <div key={op.operation} className="flex items-center gap-3 text-sm">
                        <span className="w-20 capitalize text-muted shrink-0">{op.operation}</span>
                        <div className="flex-1 h-1.5 bg-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent/60 rounded-full"
                            style={{
                              width: `${(op.costUsd / Math.max(data.deepseek.totalCostUsd, 0.000001)) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-muted text-xs w-16 text-right shrink-0">
                          {op.count}× · {fmtCost(op.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Daily chart */}
              {data.deepseek.byDay.length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-wide font-medium mb-3">Daily cost</p>
                  <BarChart data={data.deepseek.byDay} />
                </div>
              )}

              {data.deepseek.callCount === 0 && (
                <p className="text-sm text-muted text-center py-2">No DeepSeek calls in this period.</p>
              )}
            </div>
          </div>

          {/* Resend card */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Mail size={14} className="text-purple-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">Resend</p>
                <p className="text-xs text-muted">Magic link emails · 3,000/mo free</p>
              </div>
              {data.resend.error ? (
                <div className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                  <AlertCircle size={12} />
                  {data.resend.error}
                </div>
              ) : (
                <div className="ml-auto text-right">
                  <p className="text-xl font-bold">{data.resend.emailsSent}</p>
                  <p className="text-xs text-muted">emails sent</p>
                </div>
              )}
              <a
                href="https://resend.com/emails"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 p-1.5 rounded hover:bg-bg text-muted hover:text-text transition-colors"
                title="Open Resend"
              >
                <ExternalLink size={13} />
              </a>
            </div>
            {!data.resend.error && (
              <div className="px-5 pb-4">
                <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500/60 rounded-full"
                    style={{ width: `${Math.min((data.resend.emailsSent / 3000) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted mt-1">{data.resend.emailsSent} / 3,000 free tier</p>
              </div>
            )}
          </div>

          {/* External link cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXTERNAL.map((svc) => (
              <a
                key={svc.name}
                href={svc.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-3 rounded-xl border px-5 py-4 hover:opacity-80 transition-opacity ${svc.color}`}
              >
                <svc.icon size={16} className="shrink-0 text-muted" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{svc.name}</p>
                  <p className="text-xs text-muted">{svc.desc}</p>
                </div>
                <ExternalLink size={13} className="ml-auto shrink-0 text-muted" />
              </a>
            ))}
          </div>

          <p className="text-xs text-muted text-center pb-4">
            Showing data since {new Date(data.since).toLocaleDateString()}
          </p>
        </>
      )}
    </div>
  );
}
