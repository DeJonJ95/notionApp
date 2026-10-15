'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Undo2, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { FieldChange, PlannedChange, ProjectResult } from '@/lib/assist/types';

const FIELD_LABEL: Record<FieldChange['field'], string> = { title: 'Name', status: 'Status', phase: 'Phase', due: 'Due', waitsOn: 'Waits on' };

function show(field: FieldChange['field'], v: string): string {
  if (!v) return 'none';
  if (field !== 'due' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChangeRow({ c, on, toggle, locked }: { c: PlannedChange; on: boolean; toggle: () => void; locked: boolean }) {
  return (
    <label className={`flex gap-2 rounded border border-border p-2 text-sm ${locked ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={on} onChange={toggle} disabled={locked} className="mt-1 shrink-0" />
      <div className="min-w-0 space-y-1">
        <div className="font-medium">
          <span className={`mr-1.5 rounded px-1.5 py-0.5 text-xs ${c.op === 'add' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-accent/10 text-accent'}`}>
            {c.op === 'add' ? 'New' : 'Change'}
          </span>
          {c.title}
        </div>
        {c.fields.length > 0 && (
          <ul className="space-y-0.5">
            {c.fields.map((f) => (
              <li key={f.field}>
                {FIELD_LABEL[f.field]}: {c.op === 'update' && f.before && <><span className="line-through decoration-red-400/70">{show(f.field, f.before)}</span> → </>}
                <strong>{show(f.field, f.after)}</strong>
              </li>
            ))}
          </ul>
        )}
        {c.reason && <p>{c.reason}</p>}
        {c.warnings.map((w) => (
          <p key={w} className="flex items-start gap-1 text-amber-800 dark:text-amber-300"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</p>
        ))}
      </div>
    </label>
  );
}

type Props = { plan: ProjectResult; busy: boolean; canUndo: boolean; onApply: (accept: number[]) => void; onUndo: () => void };

export function PlanView({ plan, busy, canUndo, onApply, onUndo }: Props) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(plan.changes.map((_, i) => i)));
  useEffect(() => { setChosen(new Set(plan.changes.map((_, i) => i))); }, [plan.changes]);
  const applied = plan.applied && !plan.applied.undone;
  const toggle = (i: number) => setChosen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="space-y-3">
      <p className="text-sm">{plan.summary}</p>
      <Link href={`/database/${plan.target.databaseId}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ExternalLink size={13} /> {plan.target.name}
      </Link>
      {plan.changes.length === 0 && <p className="text-sm">No changes needed. Ask for something specific below.</p>}
      <div className="space-y-2">
        {plan.changes.map((c, i) => <ChangeRow key={`${c.taskId ?? c.ref}-${i}`} c={c} on={chosen.has(i)} toggle={() => toggle(i)} locked={!!applied || busy} />)}
      </div>
      {applied ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={14} /> Applied {plan.applied!.count} change{plan.applied!.count === 1 ? '' : 's'}</span>
          {canUndo && (
            <button onClick={onUndo} disabled={busy} className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Undo
            </button>
          )}
        </div>
      ) : (
        plan.changes.length > 0 && (
          <button onClick={() => onApply([...chosen].sort((a, b) => a - b))} disabled={busy || !chosen.size} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />} Apply {chosen.size} change{chosen.size === 1 ? '' : 's'}
          </button>
        )
      )}
      {plan.applied?.undone && <p className="text-sm">Undone. The project is back as it was.</p>}
    </div>
  );
}
