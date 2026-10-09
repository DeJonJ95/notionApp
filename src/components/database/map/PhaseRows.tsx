'use client';

export type CopyRow = { id: string; title: string; orig: string; due: string; on: boolean; edited: boolean };
export type NewRow = { title: string; due: string };

const input = 'min-h-[36px] rounded-lg border border-border bg-bg px-2 text-sm';

function fmt(d: string) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no date';
}

export function CopyRows({ rows, onChange }: { rows: CopyRow[]; onChange: (id: string, patch: Partial<CopyRow>) => void }) {
  if (!rows.length) return <p className="m-0 text-sm">That phase has no tasks yet.</p>;
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide border-b border-border">
          <th className="py-2 w-8"><span className="sr-only">Copy</span></th>
          <th className="py-2">Task</th>
          <th className="py-2 whitespace-nowrap">Was due</th>
          <th className="py-2 whitespace-nowrap">New due date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border last:border-0">
            <td className="py-1.5"><input type="checkbox" checked={r.on} onChange={() => onChange(r.id, { on: !r.on })} aria-label={`Copy ${r.title}`} className="w-4 h-4" /></td>
            <td className="py-1.5 pr-2">{r.title}</td>
            <td className="py-1.5 pr-2 whitespace-nowrap">{fmt(r.orig)}</td>
            <td className="py-1.5">
              <input type="date" value={r.due} disabled={!r.on} onChange={(e) => onChange(r.id, { due: e.target.value, edited: true })}
                aria-label={`New due date for ${r.title}`} className={input} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NewRows({ rows, onChange }: { rows: NewRow[]; onChange: (rows: NewRow[]) => void }) {
  const set = (i: number, patch: Partial<NewRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <input value={r.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="New task" aria-label="New task title" className={`${input} flex-1 min-w-[180px]`} />
          <input type="date" value={r.due} onChange={(e) => set(i, { due: e.target.value })} aria-label="New task due date" className={input} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { title: '', due: '' }])} className="self-start min-h-[36px] px-3 rounded-lg border border-border text-sm">
        Add another task
      </button>
    </div>
  );
}
