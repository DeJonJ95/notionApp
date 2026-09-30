'use client';

import { useMemo, useState } from 'react';
import { Check, Search, Trash2 } from 'lucide-react';
import { RSVP_LABELS, SOURCE_LABELS, type Guest } from './types';

type Filter = 'all' | 'came' | 'no-show' | 'walk-in';

const FILTERS: { key: Filter; label: string; test: (g: Guest) => boolean }[] = [
  { key: 'all', label: 'Everyone', test: () => true },
  { key: 'came', label: 'Came', test: (g) => g.attended },
  { key: 'no-show', label: 'RSVP’d, not here', test: (g) => !g.attended && (g.rsvp === 'going' || g.rsvp === 'maybe') },
  { key: 'walk-in', label: 'Walk-ins', test: (g) => g.attended && (!g.rsvp || g.source === 'walk-in' || g.source === 'qr') },
];

const GROUPS: [string, string][] = [
  ['going', 'Going'],
  ['maybe', 'Maybe'],
  ['invited', 'Invited'],
  ['', 'No RSVP'],
  ['cant-go', "Can't go"],
];

function groupByRsvp(guests: Guest[]): [string, Guest[]][] {
  return GROUPS.map(([key, label]): [string, Guest[]] => [label, guests.filter((g) => (g.rsvp ?? '') === key)]).filter(
    ([, rows]) => rows.length > 0,
  );
}

type Props = {
  guests: Guest[];
  onToggle: (g: Guest) => void;
  onRsvp: (g: Guest, rsvp: string | null) => void;
  onRemove: (g: Guest) => void;
};

function GuestRow({ g, onToggle, onRsvp, onRemove }: { g: Guest } & Omit<Props, 'guests'>) {
  return (
    <li className="flex items-center gap-3 py-2">
      <button
        onClick={() => onToggle(g)}
        aria-pressed={g.attended}
        aria-label={g.attended ? `Undo check-in for ${g.person.name}` : `Check in ${g.person.name}`}
        className={`shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors ${
          g.attended ? 'bg-accent border-accent text-white' : 'border-border text-transparent hover:border-accent'
        }`}
      >
        <Check size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text truncate">{g.person.name}</span>
          {!g.person.isPlaceholder && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted border border-border rounded px-1">
              {g.cameBefore ? `Came ${g.cameBefore}× before` : 'New'}
            </span>
          )}
        </div>
        <div className="text-xs text-muted truncate">
          {[g.guestOf && `with ${g.guestOf.name}`, g.person.contact, g.source && SOURCE_LABELS[g.source]].filter(Boolean).join(' · ')}
        </div>
      </div>
      <select
        value={g.rsvp ?? ''}
        onChange={(e) => onRsvp(g, e.target.value || null)}
        aria-label="RSVP"
        className="bg-bg text-text border border-border rounded px-1.5 py-1 text-xs"
      >
        <option value="">No RSVP</option>
        {Object.entries(RSVP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button onClick={() => onRemove(g)} aria-label={`Remove ${g.person.name}`} className="text-muted hover:text-red-500 p-1">
        <Trash2 size={14} />
      </button>
    </li>
  );
}

export function GuestTable({ guests, ...handlers }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, guests.filter(f.test).length])), [guests]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return guests
      .filter((g) => test(g) && (!q || g.person.name.toLowerCase().includes(q) || g.person.contact?.toLowerCase().includes(q)))
      .sort((a, b) => a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'base' }));
  }, [guests, query, filter]);

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a guest"
          className="w-full pl-9 pr-3 py-2.5 bg-bg text-text border border-border rounded-lg text-base focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-sm border ${filter === f.key ? 'bg-text text-bg border-text' : 'border-border text-text hover:bg-surface'}`}
          >
            {f.label} <span className="tabular-nums">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      {groupByRsvp(shown).map(([label, rows], i, all) => (
        <div key={label}>
          {all.length > 1 && (
            <h3 className={`flex items-baseline justify-between border-b-2 border-text pb-1 ${i ? 'mt-6' : ''}`}>
              <span className="text-base font-semibold text-text">{label}</span>
              <span className="text-sm text-text tabular-nums">{rows.length}</span>
            </h3>
          )}
          <ul className="divide-y divide-border">
            {rows.map((g) => <GuestRow key={g.id} g={g} {...handlers} />)}
          </ul>
        </div>
      ))}
      {shown.length === 0 && <p className="text-sm text-text py-4">Nobody matches.</p>}
    </section>
  );
}
