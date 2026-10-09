import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { detectProps, idList, valueOf, type MapDb, type MapPage, type MapProps } from '@/components/database/map/mapModel';
import { dateRange, nextTitle, daysBetween, shiftDate } from './cycle';
import { cloneForCycle } from './cloneDatabase';

export type CycleInput = { mapDbId: string; projectIds: string[]; label: string; fromDate?: string; toDate?: string; names?: Record<string, string> };
export type CyclePreview = { id: string; title: string; newTitle: string; tasks: number; from: string | null; to: string | null; shiftedTo: string | null; shiftedFrom: string | null };

async function loadMap(userId: string, mapDbId: string): Promise<MapDb | null> {
  const db = await prisma.database.findFirst({
    where: { id: mapDbId, workspace: { ownerId: userId } },
    include: { properties: true, pages: { where: { isArchived: false }, include: { properties: true } } },
  });
  if (!db) return null;
  return {
    id: db.id, workspaceId: db.workspaceId, properties: db.properties,
    pages: db.pages.map((p) => ({ id: p.id, title: p.title, properties: p.properties.map((v) => ({ property: { id: v.propertyId }, value: v.value })) })),
  };
}

function taskDbOf(page: MapPage, props: MapProps): string {
  return String(valueOf(page, props.taskDb) ?? '').trim();
}

export async function previewCycle(userId: string, input: CycleInput) {
  const map = await loadMap(userId, input.mapDbId);
  if (!map) return null;
  const props = detectProps(map);
  const chosen = map.pages.filter((p) => input.projectIds.includes(p.id) && taskDbOf(p, props));
  const rows = await Promise.all(chosen.map(async (p) => {
    const dates = await prisma.propertyValue.findMany({
      where: { page: { databaseId: taskDbOf(p, props), isArchived: false }, property: { type: 'date' } },
      select: { value: true },
    });
    const tasks = await prisma.page.count({ where: { databaseId: taskDbOf(p, props), isArchived: false } });
    return { page: p, tasks, range: dateRange(dates.map((d) => d.value)) };
  }));
  const suggestedFrom = rows.map((r) => r.range?.last).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
  const from = input.fromDate || suggestedFrom;
  const days = from && input.toDate ? daysBetween(from, input.toDate) : 0;
  const projects: CyclePreview[] = rows.map(({ page, tasks, range }) => ({
    id: page.id, title: page.title, newTitle: nextTitle(page.title, input.label, days), tasks,
    from: range?.first ?? null, to: range?.last ?? null,
    shiftedFrom: range ? String(shiftDate(range.first, days)) : null, shiftedTo: range ? String(shiftDate(range.last, days)) : null,
  }));
  return { projects, suggestedFrom, days, skipped: input.projectIds.length - chosen.length };
}

function statusOptionsWithArchived(formula: string | null): string | null {
  try {
    const opts: unknown = JSON.parse(formula || '[]');
    const list = Array.isArray(opts) ? opts.map(String) : [];
    return list.includes('Archived') ? null : JSON.stringify([...list, 'Archived']);
  } catch {
    return null;
  }
}

export async function runCycle(userId: string, input: CycleInput) {
  const map = await loadMap(userId, input.mapDbId);
  if (!map || !input.fromDate || !input.toDate) return null;
  const props = detectProps(map);
  const days = daysBetween(input.fromDate, input.toDate);
  const chosen = map.pages.filter((p) => input.projectIds.includes(p.id) && taskDbOf(p, props));
  return prisma.$transaction(async (tx) => {
    const fresh = new Map<string, string>();
    for (const p of chosen) {
      const title = input.names?.[p.id]?.trim() || nextTitle(p.title, input.label, days);
      const newDb = await cloneForCycle(tx, taskDbOf(p, props), title, days);
      const row = await tx.page.create({ data: { title, workspaceId: map.workspaceId, databaseId: map.id, authorId: userId } });
      fresh.set(p.id, row.id);
      const carry: [string | undefined, unknown][] = [[props.taskDb?.id, newDb], [props.lane?.id, valueOf(p, props.lane)], [props.status?.id, 'Planned']];
      const data = carry.filter((c): c is [string, unknown] => Boolean(c[0]) && c[1] !== undefined && c[1] !== null)
        .map(([propertyId, value]) => ({ propertyId, pageId: row.id, value: value as Prisma.InputJsonValue }));
      await tx.propertyValue.createMany({ data });
      if (props.status) await tx.propertyValue.upsert({
        where: { propertyId_pageId: { propertyId: props.status.id, pageId: p.id } },
        update: { value: 'Archived' }, create: { propertyId: props.status.id, pageId: p.id, value: 'Archived' },
      });
    }
    await linkDependencies(tx, chosen, props, fresh);
    const opts = props.status ? statusOptionsWithArchived(props.status.formula ?? null) : null;
    if (props.status && opts) await tx.property.update({ where: { id: props.status.id }, data: { formula: opts } });
    return { created: Array.from(fresh.values()), days };
  }, { timeout: 60_000, maxWait: 10_000 });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function linkDependencies(tx: Tx, chosen: MapPage[], props: MapProps, fresh: Map<string, string>) {
  if (!props.waitsOn) return;
  for (const p of chosen) {
    const deps = idList(valueOf(p, props.waitsOn)).map((d) => fresh.get(d) ?? d);
    if (deps.length) await tx.propertyValue.create({ data: { propertyId: props.waitsOn.id, pageId: fresh.get(p.id)!, value: deps } });
  }
}
