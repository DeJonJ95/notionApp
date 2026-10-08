'use client';

import { useEffect, useState } from 'react';
import { fetchTargetDb } from '../RelationCell';
import { idList, isDoneLabel, parseConfig, valueOf, type MapPage, type MapProp } from './mapModel';

export type TaskProgress = { done: number; total: number };
type TaskRow = { id: string; properties: { property: { name: string }; value: unknown }[] };

function taskIsDone(task: TaskRow): boolean {
  return task.properties.some(
    (pv) => (typeof pv.value === 'string' && isDoneLabel(pv.value)) || (pv.value === true && /done|complete/i.test(pv.property.name)),
  );
}

export function useTaskProgress(pages: MapPage[], tasksProp?: MapProp): Record<string, TaskProgress> {
  const [progress, setProgress] = useState<Record<string, TaskProgress>>({});
  const target = tasksProp ? String(parseConfig(tasksProp.formula).targetDatabaseId ?? '') : '';

  useEffect(() => {
    if (!target || !tasksProp) { setProgress({}); return; }
    let alive = true;
    fetchTargetDb(target).then((db) => {
      if (!alive || !db) return;
      const doneIds = new Set((db.pages as TaskRow[]).filter(taskIsDone).map((t) => t.id));
      const known = new Set(db.pages.map((t) => t.id));
      const next: Record<string, TaskProgress> = {};
      for (const p of pages) {
        const linked = idList(valueOf(p, tasksProp)).filter((id) => known.has(id));
        next[p.id] = { done: linked.filter((id) => doneIds.has(id)).length, total: linked.length };
      }
      setProgress(next);
    });
    return () => { alive = false; };
  }, [pages, tasksProp, target]);

  return progress;
}
