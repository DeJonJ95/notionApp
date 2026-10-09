'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { fetchTargetDb, invalidateTargetDb } from '../RelationCell';
import { createTask, saveValue } from './mapApi';
import { byAge, idList, isDoneLabel, openOption, parseConfig, selectOptions, valueOf, type MapDb, type MapPage, type MapProp, type MapProps } from './mapModel';

export type TaskProgress = { done: number; total: number };
export type TaskItem = { id: string; title: string; done: boolean; dbId: string };
type TaskRow = { id: string; title: string; createdAt?: string; properties: { property: { id: string; name: string }; value: unknown }[] };
type TaskDb = { id: string; name: string; workspaceId: string; properties: MapProp[]; pages: TaskRow[] };

// A project's tasks are either a whole database it points at ("Task database") or the rows its Tasks relation links.
export type TaskSource = { dbId: string; whole: boolean };

function statusProp(db: TaskDb): MapProp | undefined {
  const selects = db.properties.filter((p) => p.type === 'select');
  return selects.find((p) => /status|stage|state/i.test(p.name)) ?? selects[0];
}

function taskIsDone(task: TaskRow): boolean {
  return task.properties.some(
    (pv) => (typeof pv.value === 'string' && isDoneLabel(pv.value)) || (pv.value === true && /done|complete/i.test(pv.property.name)),
  );
}

export function sourceOf(page: MapPage, props: MapProps): TaskSource | null {
  const own = String(valueOf(page, props.taskDb) ?? '').trim();
  if (own) return { dbId: own, whole: true };
  const rel = props.tasks ? String(parseConfig(props.tasks.formula).targetDatabaseId ?? '') : '';
  return rel ? { dbId: rel, whole: false } : null;
}

function useTaskDbs(ids: string[], reload: number): Record<string, TaskDb> {
  const [dbs, setDbs] = useState<Record<string, TaskDb>>({});
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(key.split(',').filter(Boolean).map((id) => fetchTargetDb(id, reload > 0))).then((list) => {
      if (!alive) return;
      const next: Record<string, TaskDb> = {};
      for (const db of list) if (db) next[db.id] = { id: db.id, name: db.name, workspaceId: db.workspaceId ?? '', properties: db.properties ?? [], pages: db.pages };
      setDbs(next);
    });
    return () => { alive = false; };
  }, [key, reload]);
  return dbs;
}

function itemsFor(page: MapPage, props: MapProps, dbs: Record<string, TaskDb>, flips: Record<string, boolean>): TaskItem[] {
  const src = sourceOf(page, props);
  const db = src ? dbs[src.dbId] : undefined;
  if (!src || !db) return [];
  const linked = src.whole ? null : new Set(idList(valueOf(page, props.tasks)));
  return [...db.pages].sort((a, b) => byAge(a.createdAt) - byAge(b.createdAt))
    .filter((t) => !linked || linked.has(t.id))
    .map((t) => ({ id: t.id, title: t.title || 'Untitled', done: flips[t.id] ?? taskIsDone(t), dbId: db.id }));
}

export function useTasks(db: MapDb, props: MapProps, link: (projectId: string, ids: string[]) => void) {
  const [flips, setFlips] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);
  const sources = useMemo(() => Array.from(new Set(db.pages.map((p) => sourceOf(p, props)?.dbId).filter((x): x is string => Boolean(x)))).sort(), [db.pages, props]);
  const dbs = useTaskDbs(sources, reload);
  useEffect(() => setFlips({}), [dbs]);

  const items = useMemo(() => Object.fromEntries(db.pages.map((p) => [p.id, itemsFor(p, props, dbs, flips)])), [db.pages, props, dbs, flips]);
  const progress = useMemo(() => {
    const out: Record<string, TaskProgress> = {};
    for (const [id, list] of Object.entries(items)) out[id] = { done: list.filter((t) => t.done).length, total: list.length };
    return out;
  }, [items]);

  const refresh = (dbId: string) => { invalidateTargetDb(dbId); setReload((n) => n + 1); };

  const toggle = (task: TaskItem) => {
    const owner = dbs[task.dbId];
    const prop = owner && statusProp(owner);
    if (!prop) { toast.error('That task database has no Status to tick.'); return; }
    const opts = selectOptions(prop);
    const value = task.done ? opts.find((o) => !isDoneLabel(o)) ?? '' : opts.find(isDoneLabel) ?? 'Done';
    setFlips((f) => ({ ...f, [task.id]: !task.done }));
    saveValue(task.id, prop.id, value).then(() => refresh(task.dbId)).catch(() => { toast.error('Couldn’t update that task.'); refresh(task.dbId); });
  };

  const add = async (projectId: string, title: string) => {
    const page = db.pages.find((p) => p.id === projectId);
    const src = page && sourceOf(page, props);
    const target = src && dbs[src.dbId];
    if (!src || !target) return;
    try {
      const st = statusProp(target);
      const id = await createTask(target.workspaceId, target.id, title, st ? { id: st.id, value: openOption(st) } : undefined);
      if (id && !src.whole) link(projectId, [...(items[projectId] ?? []).map((t) => t.id), id]);
      refresh(target.id);
    } catch { toast.error('Couldn’t add that task.'); }
  };

  const sourceFor = (id: string) => {
    const page = db.pages.find((p) => p.id === id);
    const src = page ? sourceOf(page, props) : null;
    return src ? { ...src, name: dbs[src.dbId]?.name ?? 'its task database', count: dbs[src.dbId]?.pages.length ?? 0 } : null;
  };

  return { items, progress, toggle, add, sourceFor };
}
