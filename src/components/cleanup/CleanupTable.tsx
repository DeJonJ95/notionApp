'use client';

import Link from 'next/link';
import type { Candidate, CleanupReason } from '@/lib/cleanup/candidates';

export const REASON_LABEL: Record<CleanupReason, string> = {
  trashed: 'In trash',
  empty: 'Empty',
  untitled: 'Untitled',
  test: 'Looks like a test',
  stale: 'Not touched in 6+ months',
};

type Props = {
  rows: Candidate[];
  selected: Set<string>;
  toggle: (key: string) => void;
  toggleAll: () => void;
};

export const keyOf = (c: Candidate) => `${c.kind}:${c.id}`;

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function CleanupTable({ rows, selected, toggle, toggleAll }: Props) {
  const allOn = rows.length > 0 && rows.every((r) => selected.has(keyOf(r)));
  return (
    <div className="overflow-x-auto border border-border rounded-xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide border-b border-border bg-surface">
            <th className="p-3 w-10">
              <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select every row shown" className="w-4 h-4" />
            </th>
            <th className="p-3">Name</th>
            <th className="p-3">Workspace</th>
            <th className="p-3">Why</th>
            <th className="p-3">Size</th>
            <th className="p-3 whitespace-nowrap">Last edited</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={keyOf(c)} className="border-b border-border last:border-0 hover:bg-surface">
              <td className="p-3">
                <input type="checkbox" checked={selected.has(keyOf(c))} onChange={() => toggle(keyOf(c))} aria-label={`Select ${c.title}`} className="w-4 h-4" />
              </td>
              <td className="p-3 max-w-[320px]">
                <Link href={c.kind === 'database' ? `/database/${c.id}` : `/page/${c.id}`} className="font-medium hover:underline truncate block">
                  {c.title}
                </Link>
                {c.kind === 'database' ? <span className="text-xs">Database</span> : null}
              </td>
              <td className="p-3 whitespace-nowrap">{c.workspace}</td>
              <td className="p-3">
                <span className="flex flex-wrap gap-1">
                  {c.reasons.map((r) => <span key={r} className="px-2 py-0.5 rounded-full border border-border text-xs whitespace-nowrap">{REASON_LABEL[r]}</span>)}
                </span>
              </td>
              <td className="p-3 whitespace-nowrap">{c.detail}</td>
              <td className="p-3 whitespace-nowrap">{age(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
