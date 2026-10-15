// Turns the model's proposed task changes into a plan the person can review.
// Nothing the model says is trusted: task ids must exist in this list, values
// must fit the list's fields, and no-op edits are dropped. Dependency and date
// problems are surfaced as warnings rather than silently fixed.

import { isDoneLabel } from '@/components/database/map/mapModel';
import type { FieldChange, PlannedChange } from './types';
import type { ProjectData } from './projects';

type Raw = Record<string, unknown>;
type Set_ = PlannedChange['set'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHANGES = 30;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const has = (r: Raw, k: string) => Object.prototype.hasOwnProperty.call(r, k);

function pickStatus(v: unknown, data: ProjectData): string | undefined {
  if (!data.props.status) return undefined;
  const s = str(v).toLowerCase();
  return data.statusOptions.find((o) => o.toLowerCase() === s);
}

function pickDue(v: unknown): string | null | undefined {
  if (v === null || v === '') return null;
  const s = str(v);
  return DATE.test(s) ? s : undefined;
}

function pickDeps(v: unknown, known: Set<string>, self: string): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return Array.from(new Set(v.map(String).filter((id) => known.has(id) && id !== self)));
}

function readSet(r: Raw, data: ProjectData, known: Set<string>, self: string): Set_ {
  const set: Set_ = {};
  const title = str(r.title).slice(0, 200);
  if (title) set.title = title;
  const status = pickStatus(r.status, data);
  if (status) set.status = status;
  const phase = str(r.phase);
  if (phase && data.props.phase) set.phase = phase.slice(0, 80);
  if (has(r, 'due') && data.props.due) {
    const due = pickDue(r.due);
    if (due !== undefined) set.due = due;
  }
  if (has(r, 'waitsOn') && data.props.waitsOn) {
    const deps = pickDeps(r.waitsOn, known, self);
    if (deps) set.waitsOn = deps;
  }
  return set;
}

type Names = Map<string, string>;

function depNames(ids: string[], names: Names): string {
  return ids.map((id) => names.get(id) ?? 'Unknown task').join(', ') || 'Nothing';
}

function fieldChanges(set: Set_, current: { title: string; status: string; phase: string; due: string; waitsOn: string[] } | null, names: Names): FieldChange[] {
  const out: FieldChange[] = [];
  const cur = current ?? { title: '', status: '', phase: '', due: '', waitsOn: [] };
  const push = (field: FieldChange['field'], before: string, after: string) => { if (before !== after) out.push({ field, before, after }); };
  if (set.title !== undefined && current) push('title', cur.title, set.title);
  if (set.status !== undefined) push('status', cur.status, set.status);
  if (set.phase !== undefined) push('phase', cur.phase, set.phase);
  if (set.due !== undefined) push('due', cur.due, set.due ?? '');
  if (set.waitsOn !== undefined && (current || set.waitsOn.length)) {
    const same = [...cur.waitsOn].sort().join() === [...set.waitsOn].sort().join();
    if (!same) out.push({ field: 'waitsOn', before: depNames(cur.waitsOn, names), after: depNames(set.waitsOn, names) });
  }
  return out;
}

function addRefs(raw: Raw[]): Map<Raw, string> {
  const refs = new Map<Raw, string>();
  raw.forEach((r, i) => { if (r.op === 'add' && str(r.title)) refs.set(r, str(r.ref) || `n${i + 1}`); });
  return refs;
}

function buildChange(r: Raw, ctx: { data: ProjectData; known: Set<string>; refs: Map<Raw, string>; names: Names }): PlannedChange | null {
  const reason = str(r.reason);
  if (r.op === 'add') {
    const ref = ctx.refs.get(r);
    if (!ref) return null;
    const set = readSet(r, ctx.data, ctx.known, ref);
    set.title = str(r.title).slice(0, 200);
    return { op: 'add', ref, title: set.title, set, fields: fieldChanges(set, null, ctx.names), reason, warnings: [] };
  }
  const task = ctx.data.tasks.find((t) => t.id === str(r.taskId));
  if (r.op !== 'update' || !task) return null;
  const set = readSet(r, ctx.data, ctx.known, task.id);
  const fields = fieldChanges(set, task, ctx.names);
  if (!fields.length) return null;
  return { op: 'update', taskId: task.id, title: task.title, set, fields, reason, warnings: [] };
}

/** Validated changes, each with what it changes and any warnings. */
export function planChanges(rawChanges: unknown, data: ProjectData, today: string): PlannedChange[] {
  const raw = (Array.isArray(rawChanges) ? rawChanges : []).filter((r): r is Raw => !!r && typeof r === 'object').slice(0, MAX_CHANGES);
  const refs = addRefs(raw);
  const names: Names = new Map(data.tasks.map((t) => [t.id, t.title]));
  raw.forEach((r) => { const ref = refs.get(r); if (ref) names.set(ref, str(r.title)); });
  const known = new Set(names.keys());
  const changes = raw.map((r) => buildChange(r, { data, known, refs, names })).filter((c): c is PlannedChange => !!c);
  addWarnings(changes, data, today, names);
  return changes;
}

function finalState(changes: PlannedChange[], data: ProjectData) {
  const due = new Map(data.tasks.map((t) => [t.id, t.due]));
  const deps = new Map(data.tasks.map((t) => [t.id, t.waitsOn]));
  const status = new Map(data.tasks.map((t) => [t.id, t.status]));
  for (const c of changes) {
    const id = c.taskId ?? c.ref!;
    if (c.set.due !== undefined) due.set(id, c.set.due ?? '');
    if (c.set.waitsOn !== undefined) deps.set(id, c.set.waitsOn);
    if (c.set.status !== undefined) status.set(id, c.set.status);
  }
  return { due, deps, status };
}

type Final = ReturnType<typeof finalState>;

function dependencyWarnings(id: string, mine: string, state: Final, names: Names): string[] {
  return (state.deps.get(id) ?? []).flatMap((dep) => {
    const theirs = state.due.get(dep) ?? '';
    return mine && theirs && mine < theirs ? [`Due before ${names.get(dep) ?? 'a task'} (${theirs}), which it waits on.`] : [];
  });
}

function addWarnings(changes: PlannedChange[], data: ProjectData, today: string, names: Names) {
  const state = finalState(changes, data);
  const titles = new Set(data.tasks.map((t) => t.title.toLowerCase()));
  for (const c of changes) {
    const id = c.taskId ?? c.ref!;
    const mine = state.due.get(id) ?? '';
    if (c.op === 'add' && titles.has(c.title.toLowerCase())) c.warnings.push('A task with this name already exists.');
    if (mine && mine < today && !isDoneLabel(state.status.get(id) ?? '')) c.warnings.push('Due date is in the past.');
    c.warnings.push(...dependencyWarnings(id, mine, state, names));
  }
}

/**
 * The accepted part of a stored plan, re-checked against the list as it is now:
 * tasks deleted since the plan was made are skipped, and dependencies on
 * rejected or vanished tasks are dropped.
 */
export function keepValid(changes: PlannedChange[], accept: number[], data: ProjectData): PlannedChange[] {
  const chosen = changes.filter((_, i) => accept.includes(i));
  const ids = new Set(data.tasks.map((t) => t.id));
  const live = chosen.filter((c) => c.op === 'add' || ids.has(c.taskId ?? ''));
  const known = new Set([...ids, ...live.flatMap((c) => (c.ref ? [c.ref] : []))]);
  return live.map((c) => (c.set.waitsOn ? { ...c, set: { ...c.set, waitsOn: c.set.waitsOn.filter((d) => known.has(d)) } } : c));
}
