import { prisma } from './prisma';
import { DB_TEMPLATES } from './dbTemplates';

// The Personal Budget feature works against the user's "Personal Budget"
// database (built from the template). This module finds or creates it.

export type BudgetDb = {
  id: string;
  name: string;
  properties: { id: string; name: string; type: string }[];
};

export async function findOrCreateBudgetDb(userId: string): Promise<BudgetDb> {
  // 1. Look for an existing database the user owns whose schema matches the
  //    Personal Budget template (must have Amount, Date, Category, Vendor).
  const existing = await prisma.database.findFirst({
    where: {
      workspace: { ownerId: userId },
      AND: [
        { properties: { some: { name: 'Amount', type: 'number' } } },
        { properties: { some: { name: 'Date', type: 'date' } } },
        { properties: { some: { name: 'Category' } } },
        { properties: { some: { name: 'Vendor' } } },
      ],
    },
    include: { properties: true },
    orderBy: { createdAt: 'asc' },
  });

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      properties: existing.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
    };
  }

  // 2. None exists — bootstrap one in the user's first workspace using the
  //    'personal-budget' template.
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
  });
  if (!workspace) throw new Error('No workspace found for user');

  const template = DB_TEMPLATES.find((t) => t.id === 'personal-budget')!;

  const created = await prisma.$transaction(async (tx) => {
    const db = await tx.database.create({
      data: { name: template.name, workspaceId: workspace.id },
    });
    for (let i = 0; i < template.properties.length; i++) {
      const prop = template.properties[i];
      await tx.property.create({
        data: {
          name: prop.name,
          type: prop.type,
          formula: prop.type === 'formula'
            ? (prop.formula ?? null)
            : (prop.options ? JSON.stringify(prop.options) : null),
          position: (i + 1) * 1024,
          databaseId: db.id,
        },
      });
    }
    for (const view of template.views) {
      await tx.view.create({ data: { name: view.name, type: view.type, databaseId: db.id } });
    }
    return tx.database.findUnique({ where: { id: db.id }, include: { properties: true } });
  });

  return {
    id: created!.id,
    name: created!.name,
    properties: created!.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
  };
}

export type ParsedTransaction = {
  date: string;        // ISO YYYY-MM-DD
  vendor: string;
  description: string;
  amount: number;      // negative = expense, positive = income
  category: string;    // one of DB Category options
};

// Bulk-write transactions as pages with property values.
export async function writeTransactions(
  userId: string,
  databaseId: string,
  transactions: ParsedTransaction[]
): Promise<{ created: number }> {
  const db = await prisma.database.findFirst({
    where: { id: databaseId, workspace: { ownerId: userId } },
    include: { properties: true },
  });
  if (!db) throw new Error('Budget database not found');

  // Build a name → propertyId lookup
  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  const requiredProps = ['Type', 'Category', 'Amount', 'Date', 'Vendor', 'Status'];
  for (const name of requiredProps) {
    if (!propId[name]) throw new Error(`Budget DB missing property: ${name}`);
  }

  let created = 0;
  for (const tx of transactions) {
    const type = tx.amount >= 0 ? 'Income' : 'Expense';
    const page = await prisma.page.create({
      data: {
        title: tx.vendor || tx.description.slice(0, 60),
        workspaceId: db.workspaceId,
        databaseId: db.id,
        authorId: userId,
        position: Date.now() + created,
      },
    });
    const writes: { propertyId: string; value: any }[] = [
      { propertyId: propId['Type'],     value: type },
      { propertyId: propId['Category'], value: tx.category },
      { propertyId: propId['Amount'],   value: Math.abs(tx.amount) },
      { propertyId: propId['Date'],     value: tx.date },
      { propertyId: propId['Vendor'],   value: tx.vendor },
      { propertyId: propId['Status'],   value: 'Cleared' },
    ];
    if (propId['Notes'] && tx.description !== tx.vendor) {
      writes.push({ propertyId: propId['Notes'], value: tx.description });
    }
    await prisma.propertyValue.createMany({
      data: writes.map((w) => ({ ...w, pageId: page.id })),
    });
    created++;
  }
  return { created };
}
