'use client';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Source } from '@/lib/budgetAssist/assistant';

const TOOL_LABEL: Record<string, string> = {
  spend_by_category: 'Spend by category',
  month_over_month: 'Month over month',
  budget_variance: 'Budget vs actual',
  month_to_date_pace: 'Month-to-date pace',
  spend_by_merchant_group: 'Merchant group spend',
  bill_payment_status: 'Bill payments',
  top_transactions: 'Largest purchases',
};

const ROWS_SHOWN = 10;

const day = (iso: unknown) =>
  typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : String(iso);

function describeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (args.start_date && args.end_date) parts.push(`${day(args.start_date)} to ${day(args.end_date)}`);
  if (args.month) parts.push(String(args.month));
  if (args.months) parts.push(`last ${args.months} closed months${args.include_current_month ? ' plus this month' : ''}`);
  if (args.group) parts.push(`group ${args.group}`);
  if (args.category) parts.push(`category ${args.category}`);
  if (args.limit) parts.push(`top ${args.limit}`);
  return parts.join(' · ');
}

const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

function RowsTable({ rows }: { rows: Source['rows'] }) {
  const [all, setAll] = useState(false);
  const columns = Object.keys(rows[0] ?? {}).filter((c) => rows.some((r) => r[c] !== null && r[c] !== undefined));
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr>{columns.map((c) => <th key={c} className="text-left font-medium px-1.5 py-1 whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-t border-border/50">
              {columns.map((c) => <td key={c} className="px-1.5 py-1 whitespace-nowrap font-mono">{show(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > ROWS_SHOWN && (
        <button onClick={() => setAll(!all)} className="mt-1 text-[11px] text-accent">
          {all ? 'Show fewer rows' : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
}

/** The tools a reply was built from: their arguments and the rows they returned. */
export function SourcesView({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-xs text-accent">
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        How I got this
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {sources.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <p className="text-xs font-semibold">{TOOL_LABEL[s.tool] ?? s.tool}</p>
              <p className="text-xs mb-1">{describeArgs(s.args)}</p>
              {s.error ? <p className="text-xs text-red-600">{s.error}</p> : s.rows.length === 0 ? <p className="text-xs">No rows.</p> : <RowsTable rows={s.rows} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
