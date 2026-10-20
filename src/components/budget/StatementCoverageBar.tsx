'use client';
import { AlertTriangle, CheckCircle2, FileText, Upload } from 'lucide-react';
import type { StatementCoverage } from '@/lib/budgetStatement';

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);

function label(iso: string, today: string): string {
  if (iso === today) return 'today';
  const d = new Date(iso + 'T00:00:00');
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function ImportButton({ onImport }: { onImport: () => void }) {
  return (
    <button
      onClick={onImport}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 shrink-0"
    >
      <Upload size={12} /> Import statement
    </button>
  );
}

// The first thing on the budget page: which dates the imported statements
// account for, which are missing, and what to download from the bank next.
export function StatementCoverageBar({ coverage, onImport }: { coverage: StatementCoverage | null; onImport: () => void }) {
  if (!coverage) {
    return (
      <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 flex items-center gap-3">
        <FileText size={18} className="text-accent shrink-0" />
        <p className="flex-1 min-w-0 text-sm font-medium">No bank statements imported yet. Upload one to start tracking.</p>
        <ImportButton onImport={onImport} />
      </div>
    );
  }
  const today = todayIso();
  const current = coverage.through >= today;
  const behind = daysBetween(coverage.through, today);
  const attention = coverage.gaps.length > 0 || behind > STALE_DAYS;
  const Icon = attention ? AlertTriangle : CheckCircle2;
  return (
    <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-start gap-3 ${attention ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-border bg-surface'}`}>
      <Icon size={18} className={`shrink-0 mt-0.5 ${attention ? 'text-yellow-600' : 'text-green-600'}`} />
      <div className="flex-1 min-w-[12rem] space-y-0.5">
        <p className="text-sm font-semibold">Accounted for through {label(coverage.through, today)}</p>
        {!current && (
          <p className="text-sm">
            Next download: {behind === 1 ? 'today' : `${label(shift(coverage.through, 1), today)} to today`}
          </p>
        )}
        {coverage.gaps.map((g) => (
          <p key={g.from} className="text-sm text-yellow-700">
            Missing {label(g.from, today)} to {label(g.to, today)} ({g.days} {g.days === 1 ? 'day' : 'days'})
          </p>
        ))}
        {coverage.account && <p className="text-xs text-muted">{coverage.account}</p>}
      </div>
      <ImportButton onImport={onImport} />
    </div>
  );
}
