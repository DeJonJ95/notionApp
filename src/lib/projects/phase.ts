import { randomUUID } from 'node:crypto';
import type { Block, Prisma, Property, PropertyValue } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isStatusProp, nextCycleValue, remapIds } from './cycle';

export type PhaseTask = { sourceId?: string; title?: string; due?: string | null };
export type PhaseInput = { databaseId: string; phase: string; tasks: PhaseTask[]; moveIds?: string[] };

type Tx = Prisma.TransactionClient;
type Source = { title: string; icon: string | null; properties: PropertyValue[]; blocks: Block[] };
type Ctx = { props: Property[]; phaseProp: Property; phase: string; status?: Property; due?: Property; ids: Map<string, string> };
type Planned = { task: PhaseTask; src: Source | null; pageId: string };

function withOption(formula: string | null, option: string): string | null {
  let list: string[] = [];
  try { const j: unknown = JSON.parse(formula || '[]'); list = Array.isArray(j) ? j.map(String) : []; } catch { list = []; }
  return list.includes(option) ? null : JSON.stringify([...list, option]);
}

function valuesFor(ctx: Ctx, p: Planned): Prisma.PropertyValueCreateManyInput[] {
  const out = new Map<string, unknown>();
  for (const pv of p.src?.properties ?? []) {
    const prop = ctx.props.find((q) => q.id === pv.propertyId);
    if (prop) out.set(prop.id, nextCycleValue(prop, remapIds(pv.value, ctx.ids), 0, prop.id === ctx.status?.id));
  }
  if (!p.src && ctx.status) out.set(ctx.status.id, nextCycleValue(ctx.status, null, 0, true));
  out.set(ctx.phaseProp.id, ctx.phase);
  if (ctx.due && p.task.due !== undefined) out.set(ctx.due.id, p.task.due || null);
  return Array.from(out.entries())
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([propertyId, value]) => ({ propertyId, pageId: p.pageId, value: value as Prisma.InputJsonValue }));
}

function blocksFor(ctx: Ctx, p: Planned): Prisma.BlockCreateManyInput[] {
  const blocks = p.src?.blocks ?? [];
  for (const b of blocks) ctx.ids.set(b.id, randomUUID());
  return blocks.map((b) => ({
    id: ctx.ids.get(b.id)!, pageId: p.pageId, type: b.type, content: b.content as Prisma.InputJsonValue, position: b.position,
    canvasX: b.canvasX, canvasY: b.canvasY, canvasWidth: b.canvasWidth, parentId: b.parentId ? ctx.ids.get(b.parentId) ?? null : null,
  }));
}

async function createPages(tx: Tx, ctx: Ctx, input: PhaseInput, home: { workspaceId: string; authorId: string }): Promise<Planned[]> {
  const planned: Planned[] = [];
  for (const task of input.tasks) {
    const src = task.sourceId
      ? await tx.page.findFirst({ where: { id: task.sourceId, databaseId: input.databaseId }, include: { properties: true, blocks: true } })
      : null;
    const page = await tx.page.create({
      data: { title: src?.title ?? task.title ?? 'Untitled task', icon: src?.icon, workspaceId: home.workspaceId, databaseId: input.databaseId, authorId: home.authorId },
    });
    if (src) ctx.ids.set(task.sourceId!, page.id);
    planned.push({ task, src, pageId: page.id });
  }
  return planned;
}

// Starts a phase: adds the option to the Phase field, then copies chosen tasks (dates as given, progress reset) or creates new ones.
export async function startPhase(userId: string, input: PhaseInput) {
  const db = await prisma.database.findFirst({ where: { id: input.databaseId, workspace: { ownerId: userId } }, include: { properties: true } });
  const phaseProp = db?.properties.find((p) => p.type === 'select' && /phase/i.test(p.name));
  if (!db || !phaseProp) return null;
  const others = db.properties.filter((p) => p.id !== phaseProp.id);
  const ctx: Ctx = {
    props: db.properties, phaseProp, phase: input.phase, ids: new Map(),
    status: others.find((p) => isStatusProp(p, others)),
    due: db.properties.find((p) => p.type === 'date' && /due|deadline|date/i.test(p.name)),
  };
  return prisma.$transaction(async (tx) => {
    const formula = withOption(phaseProp.formula, input.phase);
    if (formula) await tx.property.update({ where: { id: phaseProp.id }, data: { formula } });
    const planned = await createPages(tx, ctx, input, { workspaceId: db.workspaceId, authorId: userId });
    const values = planned.flatMap((p) => valuesFor(ctx, p));
    const blocks = planned.flatMap((p) => blocksFor(ctx, p));
    if (values.length) await tx.propertyValue.createMany({ data: values });
    if (blocks.length) await tx.block.createMany({ data: blocks });
    for (const pageId of input.moveIds ?? []) {
      const owned = await tx.page.findFirst({ where: { id: pageId, databaseId: input.databaseId }, select: { id: true } });
      if (owned) await tx.propertyValue.upsert({
        where: { propertyId_pageId: { propertyId: phaseProp.id, pageId } },
        update: { value: input.phase }, create: { propertyId: phaseProp.id, pageId, value: input.phase },
      });
    }
    return { created: planned.map((p) => p.pageId) };
  }, { timeout: 60_000, maxWait: 10_000 });
}
