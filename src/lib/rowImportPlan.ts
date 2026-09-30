import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeCell, type ImportRow } from '@/lib/rowImport';

type Prop = { id: string; name: string; type: string; formula: string | null };
type Cell = { propertyId: string; value: Prisma.InputJsonValue };
export type ImportDb = {
  id: string;
  workspaceId: string;
  properties: Prop[];
  pages: { id: string; title: string; position: number }[];
};

const LINKED = ['formula', 'relation', 'rollup'];
const optionsOf = (p: Prop): string[] => (p.formula ? JSON.parse(p.formula) : []);

export function planImport(db: ImportDb, userId: string, rows: ImportRow[], defaults: Record<string, string>) {
  const propByName = new Map(db.properties.map((p) => [p.name.trim().toLowerCase(), p]));
  const known = new Map(db.pages.map((p) => [p.title.trim().toLowerCase(), p.id]));
  const ignored = new Set<string>();
  const added = new Map<string, Set<string>>();

  const resolve = (values: Record<string, string>): Cell[] => {
    const out: Cell[] = [];
    for (const [col, raw] of Object.entries(values)) {
      const prop = propByName.get(col.trim().toLowerCase());
      if (!prop || LINKED.includes(prop.type)) { ignored.add(col); continue; }
      let value = normalizeCell(prop.type, raw);
      if (value === null || value === '') continue;
      if (prop.type === 'select') {
        const known = optionsOf(prop).find((o) => o.toLowerCase() === String(value).toLowerCase());
        if (known) value = known;
        else added.set(prop.id, (added.get(prop.id) ?? new Set()).add(String(value)));
      }
      out.push({ propertyId: prop.id, value: value as Prisma.InputJsonValue });
    }
    return out;
  };

  const upsert = (propertyId: string, pageId: string, value: Prisma.InputJsonValue) =>
    prisma.propertyValue.upsert({
      where: { propertyId_pageId: { propertyId, pageId } },
      update: { value },
      create: { propertyId, pageId, value },
    });

  const minPos = db.pages.reduce((m, p) => Math.min(m, p.position), 0);
  const defaultCells = resolve(defaults);
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let created = 0;
  let updated = 0;

  rows.forEach((row, i) => {
    const key = row.title.trim().toLowerCase();
    const cells = resolve(row.values);
    const existing = known.get(key);
    if (existing) {
      updated++;
      cells.forEach((c) => ops.push(upsert(c.propertyId, existing, c.value)));
      return;
    }
    created++;
    const id = `imp${Date.now().toString(36)}${i.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    known.set(key, id);
    const merged = new Map([...defaultCells, ...cells].map((c) => [c.propertyId, c.value]));
    ops.push(
      prisma.page.create({
        data: {
          id,
          title: row.title.trim().slice(0, 200),
          workspaceId: db.workspaceId,
          databaseId: db.id,
          authorId: userId,
          position: minPos - (rows.length - i) * 1024,
          properties: { create: Array.from(merged, ([propertyId, value]) => ({ propertyId, value })) },
        },
      }),
    );
  });

  const optionOps = Array.from(added, ([propId, extra]) => {
    const prop = db.properties.find((p) => p.id === propId)!;
    return prisma.property.update({ where: { id: propId }, data: { formula: JSON.stringify([...optionsOf(prop), ...Array.from(extra)]) } });
  });

  return { ops: [...optionOps, ...ops], created, updated, ignored: Array.from(ignored) };
}
