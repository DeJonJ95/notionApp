// What the assistant can change: every project on a Projects map (each owns a
// task database) plus any other task-like database. Projects map detection
// matches app/(app)/projects/page.tsx.

import { prisma } from '@/lib/prisma';
import { looksLikeBudget, taskSchema } from '@/lib/agenda';
import { byAge, detectProps, idList, selectOptions, valueOf, type MapDb, type MapProp } from '@/components/database/map/mapModel';

export type Target = { databaseId: string; name: string; kind: 'project' | 'list' };

export type ProjectTask = { id: string; title: string; status: string; phase: string; due: string; waitsOn: string[] };

export type ProjectData = {
  databaseId: string;
  name: string;
  workspaceId: string;
  props: { status?: MapProp; phase?: MapProp; due?: MapProp; waitsOn?: MapProp };
  statusOptions: string[];
  phaseOptions: string[];
  tasks: ProjectTask[];
};

const TASK_DB_PROP = /task\s*(database|db)/i;

function isProjectsMap(db: { properties: MapProp[]; views: { type: string }[] }): boolean {
  return db.views.some((v) => v.type === 'map') && db.properties.some((p) => p.type === 'text' && TASK_DB_PROP.test(p.name));
}

export async function catalog(userId: string): Promise<Target[]> {
  const dbs = await prisma.database.findMany({
    where: { workspace: { ownerId: userId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, properties: { select: { id: true, name: true, type: true, formula: true } }, views: { select: { type: true } } },
  });
  const maps = dbs.filter(isProjectsMap);
  const taskProps = maps.flatMap((m) => m.properties.filter((p) => p.type === 'text' && TASK_DB_PROP.test(p.name)).map((p) => p.id));
  const rows = await prisma.page.findMany({
    where: { databaseId: { in: maps.map((m) => m.id) }, isArchived: false },
    select: { title: true, properties: { where: { propertyId: { in: taskProps } }, select: { value: true } } },
  });
  const known = new Set(dbs.map((d) => d.id));
  const projects: Target[] = rows.flatMap((r) => {
    const id = String(r.properties[0]?.value ?? '');
    return known.has(id) ? [{ databaseId: id, name: r.title || 'Untitled project', kind: 'project' as const }] : [];
  });
  const taken = new Set([...projects.map((p) => p.databaseId), ...maps.map((m) => m.id)]);
  const lists: Target[] = dbs
    .filter((d) => !taken.has(d.id))
    .filter((d) => { const s = taskSchema(d.properties); return !looksLikeBudget(d.properties) && !!(s.status || s.due); })
    .map((d) => ({ databaseId: d.id, name: d.name, kind: 'list' as const }));
  return [...projects, ...lists];
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

function overlap(a: string, b: string): number {
  const wa = words(a), wb = new Set(words(b));
  if (!wa.length || !wb.size) return 0;
  return wa.filter((w) => wb.has(w)).length / Math.max(wa.length, wb.size);
}

/** The target the model named, forgiving case, partial names and word order. */
export function resolveTarget(targets: Target[], name: string | null | undefined): Target | null {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  const exact = targets.find((t) => t.name.toLowerCase() === n);
  if (exact) return exact;
  const partial = targets.find((t) => t.name.toLowerCase().includes(n) || n.includes(t.name.toLowerCase()));
  if (partial) return partial;
  const best = targets.map((t) => ({ t, s: overlap(n, t.name) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 0.5 ? best.t : null;
}

export async function loadProject(userId: string, databaseId: string, name: string): Promise<ProjectData | null> {
  const db = await prisma.database.findFirst({
    where: { id: databaseId, workspace: { ownerId: userId } },
    select: {
      id: true, workspaceId: true,
      properties: { select: { id: true, name: true, type: true, formula: true } },
      pages: { where: { isArchived: false }, select: { id: true, title: true, createdAt: true, properties: { select: { propertyId: true, value: true } } } },
    },
  });
  if (!db) return null;
  const pages = db.pages.map((p) => ({ ...p, properties: p.properties.map((v) => ({ property: { id: v.propertyId }, value: v.value })) }));
  const mapDb: MapDb = { id: db.id, workspaceId: db.workspaceId, properties: db.properties, pages };
  const found = detectProps(mapDb);
  const props = { status: found.status, phase: found.lane, due: found.due, waitsOn: found.waitsOn };
  const tasks = [...pages].sort((a, b) => byAge(a.createdAt) - byAge(b.createdAt)).map((p) => ({
    id: p.id,
    title: p.title || 'Untitled',
    status: String(valueOf(p, props.status) ?? ''),
    phase: String(valueOf(p, props.phase) ?? ''),
    due: String(valueOf(p, props.due) ?? '').slice(0, 10),
    waitsOn: idList(valueOf(p, props.waitsOn)),
  }));
  return { databaseId: db.id, name, workspaceId: db.workspaceId, props, statusOptions: selectOptions(props.status), phaseOptions: selectOptions(props.phase), tasks };
}
