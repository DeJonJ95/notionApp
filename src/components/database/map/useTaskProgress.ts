'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { fetchTargetDb, invalidateTargetDb } from '../RelationCell';
import { createPage, saveValue } from './mapApi';
import { idList, isDoneLabel, parseConfig, selectOptions, valueOf, type MapDb, type MapProp } from './mapModel';

export type TaskProgress = { done: number; total: number };
export type TaskItem = { id: string; title: string; done: boolean };
type TaskRow = { id: string; title: string; properties: { property: { id: string; name: string }; value: unknown }[] };
type TaskDb = { id: string; workspaceId: string; properties: MapProp[]; pages: TaskRow[] };

function statusProp(db: TaskDb): MapProp | undefined {
  const selects = db.properties.filter((p) => p.type === 'select');
  return selects.find((p) => /status|stage|state/i.test(p.name)) ?? selects[0];
}

function taskIsDone(task: TaskRow): boolean {
  return task.properties.some(
    (pv) => (typeof pv.value === 'string' && isDoneLabel(pv.value)) || (pv.value === true && /done|complete/i.test(pv.property.name)),
  );
}

export function useTasks(db: MapDb, tasksProp: MapProp | undefined, link: (projectId: string, ids: string[]) => void) {
  const [taskDb, setTaskDb] = useState<TaskDb | null>(null);
  const [flips, setFlips] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);
  const target = tasksProp ? String(parseConfig(tasksProp.formula).targetDatabaseId ?? '') : '';

  useEffect(() => {
    if (!target) { setTaskDb(null); return; }
    let alive = true;
    fetchTargetDb(target, reload > 0).then((res) => {
      if (alive) { setTaskDb(res as TaskDb | null); setFlips({}); }
    });
    return () => { alive = false; };
  }, [target, reload]);

  const items = useMemo(() => {
    const byId = new Map((taskDb?.pages ?? []).map((t) => [t.id, { id: t.id, title: t.title || 'Untitled', done: flips[t.id] ?? taskIsDone(t) }]));
    const out: Record<string, TaskItem[]> = {};
    for (const p of db.pages) {
      out[p.id] = idList(valueOf(p, tasksProp)).map((id) => byId.get(id)).filter((t): t is TaskItem => Boolean(t));
    }
    return out;
  }, [db.pages, taskDb, flips, tasksProp]);

  const progress = useMemo(() => {
    const out: Record<string, TaskProgress> = {};
    for (const [id, list] of Object.entries(items)) out[id] = { done: list.filter((t) => t.done).length, total: list.length };
    return out;
  }, [items]);

  const refresh = () => { invalidateTargetDb(target); setReload((n) => n + 1); };

  const toggle = (task: TaskItem) => {
    const prop = taskDb && statusProp(taskDb);
    if (!prop) return;
    const opts = selectOptions(prop);
    const value = task.done ? opts.find((o) => !isDoneLabel(o)) ?? '' : opts.find(isDoneLabel) ?? 'Done';
    setFlips((f) => ({ ...f, [task.id]: !task.done }));
    saveValue(task.id, prop.id, value).then(refresh).catch(() => { toast.error('Couldn’t update that task.'); refresh(); });
  };

  const add = async (projectId: string, title: string) => {
    if (!taskDb || !tasksProp) return;
    try {
      const id = await createPage(taskDb.workspaceId, taskDb.id, title);
      if (id) link(projectId, [...(items[projectId] ?? []).map((t) => t.id), id]);
      refresh();
    } catch { toast.error('Couldn’t add that task.'); }
  };

  return { items, progress, toggle, add, enabled: Boolean(taskDb) };
}
