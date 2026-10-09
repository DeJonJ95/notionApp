'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { shiftDate } from '@/lib/projects/cycle';
import { CopyRows, NewRows, type CopyRow, type NewRow } from './PhaseRows';

export type PhaseNode = { id: string; title: string; laneValue: string; due: string };
type Props = { databaseId: string; phases: string[]; nodes: PhaseNode[]; onClose: (changed: boolean) => void };

const field = 'w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm font-normal';

function rowsFor(nodes: PhaseNode[], phase: string, days: number): CopyRow[] {
  return nodes.filter((n) => n.laneValue === phase).map((n) => ({
    id: n.id, title: n.title, orig: n.due, due: n.due ? String(shiftDate(n.due, days)) : '', on: true, edited: false,
  }));
}

function payload(copy: boolean, rows: CopyRow[], fresh: NewRow[]) {
  const copied = copy ? rows.filter((r) => r.on).map((r) => ({ sourceId: r.id, due: r.due || null })) : [];
  const added = fresh.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), due: r.due || null }));
  return [...copied, ...added];
}

export function PhaseDialog({ databaseId, phases, nodes, onClose }: Props) {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(phases.length > 0);
  const [from, setFrom] = useState(phases[phases.length - 1] ?? '');
  const [days, setDays] = useState(0);
  const [rows, setRows] = useState<CopyRow[]>(() => rowsFor(nodes, from, 0));
  const [fresh, setFresh] = useState<NewRow[]>([{ title: '', due: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setRows(rowsFor(nodes, from, 0)), [from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRows((rs) => rs.map((r) => (r.edited || !r.orig ? r : { ...r, due: String(shiftDate(r.orig, days)) })));
  }, [days]);

  const tasks = payload(copy, rows, fresh);
  const ready = name.trim() && !phases.includes(name.trim()) && tasks.length > 0 && !busy;
  const create = () => {
    setBusy(true);
    fetch(`/api/databases/${databaseId}/phase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: name.trim(), tasks }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { created: string[] }) => { toast.success(`Started ${name.trim()} with ${d.created.length} tasks.`); onClose(true); })
      .catch(() => { toast.error('Couldn’t start that phase. Nothing was changed.'); setBusy(false); });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Start new phase">
      <div className="bg-bg text-text border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
        <h2 className="m-0 text-xl font-bold">Start new phase</h2>
        <label className="flex flex-col gap-1 text-sm font-semibold">Phase name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Setup" className={field} />
        </label>
        {phases.length ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={copy} onChange={() => setCopy(!copy)} className="w-4 h-4" />
            Copy tasks from
            <select value={from} onChange={(e) => setFrom(e.target.value)} disabled={!copy} className="min-h-[36px] rounded-lg border border-border bg-bg px-2 text-sm">
              {phases.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        ) : null}
        {copy && phases.length ? (
          <>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Move every date by
              <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} className="w-24 min-h-[36px] rounded-lg border border-border bg-bg px-2 text-sm" />
              days, then change any date by hand below.
            </label>
            <CopyRows rows={rows} onChange={(id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))} />
          </>
        ) : null}
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold">New tasks</div>
          <NewRows rows={fresh} onChange={setFresh} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className="min-h-[40px] px-4 rounded-lg border border-border text-sm">Cancel</button>
          <button type="button" onClick={create} disabled={!ready} className="min-h-[40px] px-4 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-40">
            {busy ? 'Starting…' : `Start phase with ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
