import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DB_TEMPLATES, type DbPropertyDef, type DbViewDef } from '@/lib/dbTemplates';

type Targets = { self: string; companion?: string };

function templateFormula(prop: DbPropertyDef, targets: Targets): string | null {
  if (prop.type === 'formula') return prop.formula ?? null;
  if (prop.relationTo) return JSON.stringify({ targetDatabaseId: prop.relationTo === 'self' ? targets.self : targets.companion });
  return prop.options ? JSON.stringify(prop.options) : null;
}

async function buildDatabase(
  tx: Prisma.TransactionClient,
  def: { name: string; workspaceId: string; properties: DbPropertyDef[]; views: DbViewDef[] },
  companion?: string,
) {
  const db = await tx.database.create({ data: { name: def.name, workspaceId: def.workspaceId } });
  const propIds = new Map<string, string>();
  for (let i = 0; i < def.properties.length; i++) {
    const prop = def.properties[i];
    const created = await tx.property.create({
      data: {
        name: prop.name,
        type: prop.type,
        formula: templateFormula(prop, { self: db.id, companion }),
        position: (i + 1) * 1024,
        databaseId: db.id,
      },
    });
    propIds.set(prop.name, created.id);
  }
  for (const view of def.views) {
    await tx.view.create({
      data: {
        name: view.name,
        type: view.type,
        databaseId: db.id,
        filters: view.filters
          ? view.filters.flatMap((f) => (propIds.has(f.property) ? [{ propertyId: propIds.get(f.property)!, op: f.op, value: f.value }] : []))
          : undefined,
      },
    });
  }
  return db;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const { templateId, name, workspaceId } = await req.json();

  if (!templateId || !workspaceId) {
    return NextResponse.json({ error: 'templateId and workspaceId required' }, { status: 400 });
  }

  const template = DB_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId },
  });
  if (!workspace) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const dbName = (name as string | undefined)?.trim() || template.name;

  const database = await prisma.$transaction(async (tx) => {
    const companion = template.companion
      ? await buildDatabase(tx, { ...template.companion, name: `${dbName} ${template.companion.name}`, workspaceId })
      : undefined;
    return buildDatabase(tx, { ...template, name: dbName, workspaceId }, companion?.id);
  });

  return NextResponse.json({ databaseId: database.id });
}
