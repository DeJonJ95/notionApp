'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { MerchantGroups as Groups } from '@/lib/budgetAssist/merchantGroups';

async function call(init?: RequestInit, query = ''): Promise<Groups> {
  const r = await fetch(`/api/budget/merchant-groups${query}`, init);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? 'Could not load merchant groups');
  return d.groups as Groups;
}

// Patterns are matched against each transaction's raw payee and vendor,
// ignoring case and punctuation, so "McDonald's" also catches "MCDONALDS 7946".
export function MerchantGroupsDialog({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<Groups>({});
  const [group, setGroup] = useState('fast_food');
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState('');

  const run = (work: Promise<Groups>) => work.then((g) => { setGroups(g); setError(''); }).catch((e: Error) => setError(e.message));
  useEffect(() => { run(call()); }, []);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    run(call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, pattern }) }));
    setPattern('');
  };

  return (
    <div className="fixed inset-0 z-[460] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Merchant groups" className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Merchant groups</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-bg"><X size={16} /></button>
        </div>
        <p className="text-sm mb-3">The assistant counts a purchase in a group when one of these names appears in its statement text or vendor.</p>
        {Object.entries(groups).map(([name, rows]) => (
          <div key={name} className="mb-3">
            <h3 className="text-sm font-semibold mb-1">{name}</h3>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border">
                  {r.pattern}
                  <button onClick={() => run(call({ method: 'DELETE' }, `?id=${encodeURIComponent(r.id)}`))} aria-label={`Remove ${r.pattern}`} className="hover:text-red-600"><X size={11} /></button>
                </span>
              ))}
            </div>
          </div>
        ))}
        <form onSubmit={add} className="flex flex-wrap gap-2 mt-4">
          <input value={group} onChange={(e) => setGroup(e.target.value)} list="merchant-group-names" aria-label="Group" className="w-36 px-2 py-1.5 rounded border border-border bg-bg text-sm" />
          <datalist id="merchant-group-names">{Object.keys(groups).map((g) => <option key={g} value={g} />)}</datalist>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Merchant name, e.g. Culver's" aria-label="Pattern" className="flex-1 min-w-[10rem] px-2 py-1.5 rounded border border-border bg-bg text-sm" />
          <button type="submit" className="px-3 py-1.5 rounded bg-accent text-white text-sm">Add</button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
