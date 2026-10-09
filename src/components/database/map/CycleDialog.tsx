'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/feedback';

export type CycleProject = { id: string; title: string; lane: string };
type Preview = { id: string; newTitle: string; tasks: number; from: string | null; to: string | null; shiftedFrom: string | null; shiftedTo: string | null };
type PreviewRes = { projects: Preview[]; suggestedFrom: string | null; days: number };
type Props = { mapDbId: string; projects: CycleProject[]; initialLane: string | null; onClose: (changed: boolean) => void };

const field = 'w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm';

function post(body: object) {
  return fetch('/api/projects/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : Promise.reject(r)));
}

function fmt(d: string | null) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function PreviewList({ rows, days }: { rows: Preview[]; days: number }) {
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="border border-border rounded-lg px-3 py-2">
          <div className="font-semibold">{r.newTitle}</div>
          <div>
            {r.tasks} tasks{r.from ? `, ${fmt(r.from)} – ${fmt(r.to)}` : ', no due dates'}
            {r.from && days ? ` → ${fmt(r.shiftedFrom)} – ${fmt(r.shiftedTo)}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CycleDialog({ mapDbId, projects, initialLane, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(projects.filter((p) => p.lane === initialLane).map((p) => p.id)));
  const [label, setLabel] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = Array.from(picked);

  useEffect(() => {
    if (!ids.length) { setPreview(null); return; }
    const t = setTimeout(() => {
      post({ mapDbId, projectIds: ids, label: label || 'Next cycle', fromDate: fromDate || undefined, toDate: toDate || undefined, dryRun: true })
        .then((res: PreviewRes) => { setPreview(res); if (!fromDate && res.suggestedFrom) setFromDate(res.suggestedFrom); })
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [mapDbId, ids.join(','), label, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ready = ids.length > 0 && label.trim() && fromDate && toDate && !busy;
  const create = () => {
    setBusy(true);
    post({ mapDbId, projectIds: ids, label: label.trim(), fromDate, toDate })
      .then((res: { created: string[] }) => { toast.success(`Started ${res.created.length} projects for ${label.trim()}.`); onClose(true); })
      .catch(() => { toast.error('Couldn’t start the new cycle. Nothing was changed.'); setBusy(false); });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Start next cycle">
      <div className="bg-bg text-text border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
        <h2 className="m-0 text-xl font-bold">Start next cycle</h2>
        <p className="m-0 text-sm">Copies each project’s task list, resets progress, and moves every due date by the gap between the two dates. Old runs are archived, not deleted.</p>
        <fieldset className="border-0 p-0 m-0 flex flex-wrap gap-x-4 gap-y-1">
          <legend className="text-sm font-semibold mb-1">Projects</legend>
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 min-h-[32px] text-sm">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4" />{p.title}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-semibold">Cycle name
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nov 2026 General" className={`${field} font-normal`} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">Last cycle’s key date
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${field} font-normal`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">This cycle’s key date
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${field} font-normal`} />
          </label>
        </div>
        {preview ? <PreviewList rows={preview.projects} days={preview.days} /> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className="min-h-[40px] px-4 rounded-lg border border-border text-sm">Cancel</button>
          <button type="button" onClick={create} disabled={!ready} className="min-h-[40px] px-4 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-40">
            {busy ? 'Starting…' : `Start ${ids.length} project${ids.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
