'use client';

import { useEffect, useState } from 'react';
import type { TaskItem } from './useTaskProgress';

export type TaskPanel = {
  items: TaskItem[];
  color: string;
  toggle: (task: TaskItem) => void;
  add: (title: string) => Promise<void>;
  canAdd: boolean;
  picker?: SourcePicker;
};

type SourcePicker = { value: string; workspaceId: string; selfId: string; onChange: (dbId: string) => void; title?: string };

function TaskDbPicker({ value, workspaceId, selfId, onChange, title }: SourcePicker) {
  const [dbs, setDbs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/databases?workspaceId=${workspaceId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => { if (alive && Array.isArray(list)) setDbs(list.filter((d) => d.id !== selfId)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [workspaceId, selfId, title, value && !dbs.some((d) => d.id === value) ? value : '']); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Task database"
      className="w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent">
      <option value="">Task database: none</option>
      {dbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}

export function MapTasks({ items, color, toggle, add, canAdd, picker }: TaskPanel) {
  const [draft, setDraft] = useState('');
  const done = items.filter((t) => t.done).length;
  const pct = items.length ? Math.round((100 * done) / items.length) : 0;
  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    void add(title);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">Tasks</span>
        {items.length ? <span>{done} of {items.length}</span> : null}
      </div>
      {items.length ? (
        <div className="h-1.5 rounded bg-border overflow-hidden"><div className="h-1.5" style={{ width: `${pct}%`, background: color }} /></div>
      ) : null}
      {picker ? <TaskDbPicker {...picker} /> : null}
      <ul className="flex flex-col m-0 p-0 list-none">
        {items.map((t) => (
          <li key={t.id}>
            <label className="flex items-center gap-2.5 min-h-[36px] text-sm cursor-pointer">
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} className="w-4 h-4 accent-accent" />
              <span className={t.done ? 'line-through' : undefined}>{t.title}</span>
            </label>
          </li>
        ))}
      </ul>
      {canAdd ? <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Add a task and press Enter"
        aria-label="Add a task"
        className="w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
      /> : null}
    </div>
  );
}
