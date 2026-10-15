// Writes an approved plan to a task database in one transaction and records
// exactly what it replaced, so the whole apply can be undone. Callers pass a
// plan from planChanges, built server-side against the same ProjectData.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { openOption } from '@/components/database/map/mapModel';
import type { PlannedChange } from './types';
import type { ProjectData } from './projects';

type Tx = Prisma.TransactionClient;
type Json = Prisma.JsonValue;

export type UndoRecord = {
  databaseId: string;
  created: string[];
  values: { pageId: string; propertyId: string; prev: Json | null }[];
  titles: { pageId: string; prev: string }[];
  phaseFormula?: { propertyId: string; prev: string | null };
  views: { id: string; prev: Json | null }[];
};

async function writeValue(tx: Tx, pageId: string, propertyId: string, value: Json | null) {
  if (value === null || value === '') {
    await tx.propertyValue.deleteMany({ where: { pageId, propertyId } });
    return;
  }
  const v = value as Prisma.InputJsonValue;
  await tx.propertyValue.upsert({ where: { propertyId_pageId: { propertyId, pageId } }, update: { value: v }, create: { propertyId, pageId, value: v } });
}

async function addPhaseOptions(tx: Tx, data: ProjectData, changes: PlannedChange[], undo: UndoRecord) {
  const prop = data.props.phase;
  const fresh = Array.from(new Set(changes.map((c) => c.set.phase).filter((p): p is string => !!p && !data.phaseOptions.includes(p))));
  if (!prop || !fresh.length) return;
  undo.phaseFormula = { propertyId: prop.id, prev: prop.formula ?? null };
  await tx.property.update({ where: { id: prop.id }, data: { formula: JSON.stringify([...data.phaseOptions, ...fresh]) } });
}

type Ctx = { userId: string; data: ProjectData; undo: UndoRecord };

async function createTasks(tx: Tx, { userId, data, undo }: Ctx, changes: PlannedChange[]) {
  const ids = new Map<string, string>();
  const last = await tx.page.findFirst({ where: { databaseId: data.databaseId }, orderBy: { position: 'desc' }, select: { position: true } });
  let position = last?.position ?? 0;
  for (const c of changes.filter((x) => x.op === 'add')) {
    position += 1024;
    const page = await tx.page.create({ data: { title: c.title, workspaceId: data.workspaceId, databaseId: data.databaseId, authorId: userId, position } });
    ids.set(c.ref!, page.id);
    undo.created.push(page.id);
  }
  return ids;
}

function valuesFor(c: PlannedChange, data: ProjectData, ids: Map<string, string>): [string, Json | null][] {
  const { status, phase, due, waitsOn } = data.props;
  const out: [string, Json | null][] = [];
  const st = c.set.status ?? (c.op === 'add' ? openOption(status) : undefined);
  if (status && st) out.push([status.id, st]);
  if (phase && c.set.phase !== undefined) out.push([phase.id, c.set.phase]);
  if (due && c.set.due !== undefined) out.push([due.id, c.set.due]);
  if (waitsOn && c.set.waitsOn !== undefined) out.push([waitsOn.id, c.set.waitsOn.map((d) => ids.get(d) ?? d)]);
  return out;
}

async function writeChange(tx: Tx, c: PlannedChange, ctx: { data: ProjectData; ids: Map<string, string>; undo: UndoRecord }) {
  const pageId = c.taskId ?? ctx.ids.get(c.ref!)!;
  if (c.op === 'update' && c.set.title) {
    const page = await tx.page.update({ where: { id: pageId }, data: { title: c.set.title }, select: { id: true } });
    ctx.undo.titles.push({ pageId: page.id, prev: c.title });
  }
  for (const [propertyId, value] of valuesFor(c, ctx.data, ctx.ids)) {
    if (c.op === 'update') {
      const prev = await tx.propertyValue.findUnique({ where: { propertyId_pageId: { propertyId, pageId } }, select: { value: true } });
      ctx.undo.values.push({ pageId, propertyId, prev: prev?.value ?? null });
    }
    await writeValue(tx, pageId, propertyId, value);
  }
}

// A card that gains a dependency re-flows on the map when its spot was auto-placed (see useMapEdits.release).
async function releaseMapSpots(tx: Tx, data: ProjectData, changes: PlannedChange[], undo: UndoRecord) {
  const moved = new Set(changes.filter((c) => c.op === 'update' && c.set.waitsOn !== undefined).map((c) => c.taskId!));
  if (!moved.size) return;
  const views = await tx.view.findMany({ where: { databaseId: data.databaseId, type: 'map' }, select: { id: true, grouping: true } });
  for (const v of views) {
    const g = (v.grouping ?? {}) as { positions?: Record<string, { auto?: boolean }> };
    const positions = g.positions ?? {};
    const kept = Object.fromEntries(Object.entries(positions).filter(([id, spot]) => !(moved.has(id) && spot?.auto)));
    if (Object.keys(kept).length === Object.keys(positions).length) continue;
    undo.views.push({ id: v.id, prev: v.grouping });
    await tx.view.update({ where: { id: v.id }, data: { grouping: { ...g, positions: kept } as Prisma.InputJsonValue } });
  }
}

export async function applyPlan(userId: string, data: ProjectData, changes: PlannedChange[]): Promise<UndoRecord> {
  return prisma.$transaction(async (tx) => {
    const undo: UndoRecord = { databaseId: data.databaseId, created: [], values: [], titles: [], views: [] };
    await addPhaseOptions(tx, data, changes, undo);
    const ids = await createTasks(tx, { userId, data, undo }, changes);
    for (const c of changes) await writeChange(tx, c, { data, ids, undo });
    await releaseMapSpots(tx, data, changes, undo);
    return undo;
  }, { timeout: 30_000 });
}

/** Reverses one apply. Every id was recorded server-side and is re-checked against the owner's database. */
export async function undoPlan(userId: string, undo: UndoRecord): Promise<boolean> {
  const db = await prisma.database.findFirst({ where: { id: undo.databaseId, workspace: { ownerId: userId } }, select: { id: true } });
  if (!db) return false;
  await prisma.$transaction(async (tx) => {
    const inDb = { databaseId: db.id };
    await tx.page.deleteMany({ where: { id: { in: undo.created }, ...inDb } });
    for (const v of [...undo.values].reverse()) {
      const page = await tx.page.findFirst({ where: { id: v.pageId, ...inDb }, select: { id: true } });
      if (page) await writeValue(tx, v.pageId, v.propertyId, v.prev);
    }
    for (const t of undo.titles) await tx.page.updateMany({ where: { id: t.pageId, ...inDb }, data: { title: t.prev } });
    if (undo.phaseFormula) await tx.property.updateMany({ where: { id: undo.phaseFormula.propertyId, ...inDb }, data: { formula: undo.phaseFormula.prev } });
    for (const v of undo.views) await tx.view.updateMany({ where: { id: v.id, ...inDb }, data: { grouping: (v.prev ?? {}) as Prisma.InputJsonValue } });
  }, { timeout: 30_000 });
  return true;
}
