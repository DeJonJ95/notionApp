'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { DuplicateList, type Pair } from './DuplicateList';
import { api } from './types';

export type PersonRow = {
  id: string;
  name: string;
  contact: string | null;
  isPlaceholder: boolean;
  attended: number;
  rsvps: number;
  noShows: number;
  brought: number;
  lastAttended: string | null;
};

const SORTS: { key: string; label: string; cmp: (a: PersonRow, b: PersonRow) => number }[] = [
  { key: 'attended', label: 'Most events', cmp: (a, b) => b.attended - a.attended || a.name.localeCompare(b.name) },
  { key: 'recent', label: 'Last came', cmp: (a, b) => (b.lastAttended ?? '').localeCompare(a.lastAttended ?? '') },
  { key: 'noShows', label: 'Most no-shows', cmp: (a, b) => b.noShows - a.noShows },
  { key: 'brought', label: 'Brought most', cmp: (a, b) => b.brought - a.brought },
  { key: 'name', label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name) },
];

function NameCell({ p, onSaved }: { p: PersonRow; onSaved: () => void }) {
  const save = async (field: 'name' | 'contact', value: string) => {
    if (value === (p[field] ?? '')) return;
    try {
      await api(`/api/people/${p.id}`, 'PATCH', { [field]: field === 'contact' ? value || null : value });
      onSaved();
    } catch {
      toast.error('Could not save');
    }
  };
  const input = 'w-full bg-transparent text-text focus:outline-none focus:bg-bg rounded px-1';
  return (
    <td className="py-1.5 pr-2">
      <input defaultValue={p.name} onBlur={(e) => save('name', e.target.value.trim())} className={`${input} ${p.isPlaceholder ? 'italic' : ''}`} aria-label="Name" />
      <input defaultValue={p.contact ?? ''} onBlur={(e) => save('contact', e.target.value.trim())} placeholder="add contact" className={`${input} text-xs`} aria-label="Contact" />
    </td>
  );
}

export function PeopleView() {
  const [data, setData] = useState<{ people: PersonRow[]; duplicates: Pair[] } | null>(null);
  const [sort, setSort] = useState('attended');
  const [hidePlaceholders, setHidePlaceholders] = useState(true);
  const load = useCallback(() => {
    api<{ people: PersonRow[]; duplicates: Pair[] }>('/api/people').then(setData).catch(() => toast.error('Could not load people'));
  }, []);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const list = (data?.people ?? []).filter((p) => !hidePlaceholders || !p.isPlaceholder);
    return [...list].sort(SORTS.find((s) => s.key === sort)!.cmp);
  }, [data, sort, hidePlaceholders]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="space-y-1">
        <Link href="/events" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} /> Events</Link>
        <h1 className="text-2xl font-semibold text-text">People</h1>
      </div>
      {data && <DuplicateList pairs={data.duplicates} people={data.people} onMerged={load} />}
      <div className="flex flex-wrap items-center gap-3 text-sm text-text">
        <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-bg border border-border rounded px-1.5 py-1">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select></label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={hidePlaceholders} onChange={(e) => setHidePlaceholders(e.target.checked)} /> Hide unnamed +1s
        </label>
        <span className="tabular-nums">{rows.length} people</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium text-right">Came</th>
              <th className="py-2 font-medium text-right">RSVPs</th>
              <th className="py-2 font-medium text-right">No-shows</th>
              <th className="py-2 font-medium text-right">Brought</th>
              <th className="py-2 font-medium text-right pl-3">Last came</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id}>
                <NameCell p={p} onSaved={load} />
                <td className="text-right tabular-nums text-text">{p.attended}</td>
                <td className="text-right tabular-nums text-text">{p.rsvps}</td>
                <td className="text-right tabular-nums text-text">{p.noShows}</td>
                <td className="text-right tabular-nums text-text">{p.brought}</td>
                <td className="text-right tabular-nums text-text pl-3 whitespace-nowrap">
                  {p.lastAttended ? new Date(p.lastAttended).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
