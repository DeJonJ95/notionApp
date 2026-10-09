import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { isStatusProp, nextCycleValue, remapIds } from './cycle';

type Tx = Prisma.TransactionClient;
type SourceDb = NonNullable<Awaited<ReturnType<typeof loadSource>>>;

function loadSource(tx: Tx, id: string) {
  return tx.database.findUnique({
    where: { id },
    include: {
      properties: true,
      views: true,
      pages: { where: { isArchived: false }, orderBy: { createdAt: 'asc' }, include: { properties: true, blocks: true } },
    },
  });
}

async function copySchema(tx: Tx, src: SourceDb, newDbId: string, ids: Map<string, string>) {
  for (const p of src.properties) {
    const created = await tx.property.create({
      data: { name: p.name, type: p.type, formula: remapIds(p.formula, ids), position: p.position, databaseId: newDbId },
    });
    ids.set(p.id, created.id);
  }
  for (const v of src.views) {
    await tx.view.create({
      data: {
        name: v.name, type: v.type, databaseId: newDbId,
        filters: remapIds(v.filters, ids) ?? undefined,
        sorts: remapIds(v.sorts, ids) ?? undefined,
        grouping: remapIds(v.grouping, ids) ?? undefined,
      },
    });
  }
}

async function copyPages(tx: Tx, src: SourceDb, newDbId: string, ids: Map<string, string>) {
  for (const pg of src.pages) {
    const created = await tx.page.create({
      data: {
        title: pg.title, icon: pg.icon, cover: pg.cover, workspaceId: pg.workspaceId, databaseId: newDbId,
        authorId: pg.authorId, position: pg.position, viewMode: pg.viewMode,
      },
    });
    ids.set(pg.id, created.id);
  }
}

async function copyContent(tx: Tx, src: SourceDb, days: number, ids: Map<string, string>) {
  const status = src.properties.find((p) => isStatusProp(p, src.properties));
  const values: Prisma.PropertyValueCreateManyInput[] = [];
  const blocks: Prisma.BlockCreateManyInput[] = [];
  for (const pg of src.pages) {
    const pageId = ids.get(pg.id)!;
    for (const pv of pg.properties) {
      const prop = src.properties.find((p) => p.id === pv.propertyId);
      const propertyId = ids.get(pv.propertyId);
      if (!prop || !propertyId) continue;
      const next = nextCycleValue(prop, remapIds(pv.value, ids), days, prop.id === status?.id);
      if (next !== null && next !== undefined) values.push({ propertyId, pageId, value: next as Prisma.InputJsonValue });
    }
    for (const b of pg.blocks) ids.set(b.id, randomUUID());
    for (const b of pg.blocks) {
      blocks.push({
        id: ids.get(b.id)!, pageId, type: b.type, content: b.content as Prisma.InputJsonValue, position: b.position,
        canvasX: b.canvasX, canvasY: b.canvasY, canvasWidth: b.canvasWidth, parentId: b.parentId ? ids.get(b.parentId) ?? null : null,
      });
    }
  }
  if (values.length) await tx.propertyValue.createMany({ data: values });
  if (blocks.length) await tx.block.createMany({ data: blocks });
}

// Copies a task database for a new cycle: same fields, views, tasks, and task notes; dates shifted by `days`, progress reset.
export async function cloneForCycle(tx: Tx, sourceId: string, name: string, days: number): Promise<string> {
  const src = await loadSource(tx, sourceId);
  if (!src) throw new Error(`Task database ${sourceId} not found`);
  const db = await tx.database.create({ data: { name, workspaceId: src.workspaceId } });
  const ids = new Map<string, string>([[src.id, db.id]]);
  await copySchema(tx, src, db.id, ids);
  await copyPages(tx, src, db.id, ids);
  await copyContent(tx, src, days, ids);
  return db.id;
}
