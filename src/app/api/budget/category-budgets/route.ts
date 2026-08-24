import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  getBudgetCategories,
  normalizeBudgetToMonthly,
  denormalizeMonthlyBudget,
} from '@/lib/budgetDb';

// Per-category envelope targets. Each one is a Page in the user's Personal
// Budget database with Type='Budget' — the same rows the database's
// budget-summary view reads, so both surfaces stay in sync.

export type CategoryBudgetRow = {
  pageId: string;
  category: string;
  amount: number;   // monthly
  period: string;   // '' when the row has no Budget Period value
};

export type CategoryBudgetsPayload = {
  budgets: CategoryBudgetRow[];
  categoryOptions: string[];
};

type BudgetContext = {
  databaseId: string;
  workspaceId: string;
  propId: Record<string, string>;
  categoryOptions: string[];
};

async function loadContext(userId: string): Promise<BudgetContext> {
  const db = await findOrCreateBudgetDb(userId);
  const record = await prisma.database.findFirst({
    where: { id: db.id, workspace: { ownerId: userId } },
    select: { workspaceId: true },
  });
  if (!record) throw new Error('Budget database not found');

  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  return {
    databaseId: db.id,
    workspaceId: record.workspaceId,
    propId,
    categoryOptions: getBudgetCategories(db),
  };
}

async function loadBudgetRows(databaseId: string): Promise<CategoryBudgetRow[]> {
  const pages = await prisma.page.findMany({
    where: { databaseId, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
  });

  const rows: CategoryBudgetRow[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    if (String(vals['Type'] ?? '') !== 'Budget') continue;
    const category = String(vals['Category'] ?? '').trim();
    if (!category) continue;
    const raw = Math.abs(Number(vals['Budgeted Amount'] ?? 0)) || Math.abs(Number(vals['Amount'] ?? 0));
    const period = String(vals['Budget Period'] ?? '');
    rows.push({
      pageId: p.id,
      category,
      amount: Math.round(normalizeBudgetToMonthly(raw, period) * 100) / 100,
      period,
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category));
  return rows;
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const ctx = await loadContext(userId);
    const budgets = await loadBudgetRows(ctx.databaseId);
    const options = new Set(ctx.categoryOptions);
    for (const b of budgets) options.add(b.category);
    const payload: CategoryBudgetsPayload = {
      budgets,
      categoryOptions: Array.from(options).sort((a, b) => a.localeCompare(b)),
    };
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

/** Upsert one category's monthly envelope. `amount <= 0` archives the row. */
export async function PUT(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const category = String(body.category ?? '').trim();
  const amount = Number(body.amount);
  if (!category) return NextResponse.json({ error: 'category required' }, { status: 400 });
  if (!Number.isFinite(amount)) return NextResponse.json({ error: 'amount must be a number' }, { status: 400 });

  try {
    const ctx = await loadContext(userId);
    for (const name of ['Type', 'Category', 'Amount']) {
      if (!ctx.propId[name]) {
        return NextResponse.json({ error: `Budget DB missing property: ${name}` }, { status: 400 });
      }
    }

    const existing = (await loadBudgetRows(ctx.databaseId)).find((r) => r.category === category);

    if (amount <= 0) {
      if (existing) {
        await prisma.page.update({ where: { id: existing.pageId }, data: { isArchived: true } });
      }
      return NextResponse.json({ ok: true, deleted: true, category });
    }

    // Keep whatever Budget Period the row already carries, expressing the
    // monthly figure in that period so the budget-summary view agrees.
    const period = existing?.period ?? '';
    const stored = Math.round(denormalizeMonthlyBudget(amount, period) * 100) / 100;

    const pageId = existing
      ? existing.pageId
      : (
          await prisma.page.create({
            data: {
              title: `${category} budget`,
              workspaceId: ctx.workspaceId,
              databaseId: ctx.databaseId,
              authorId: userId,
              position: Date.now(),
            },
          })
        ).id;

    const writes: { propertyId: string; value: any }[] = [
      { propertyId: ctx.propId['Type'], value: 'Budget' },
      { propertyId: ctx.propId['Category'], value: category },
      { propertyId: ctx.propId['Amount'], value: stored },
    ];
    // The budget-summary view prefers "Budgeted Amount" when it is set, so
    // write both to keep a single number visible everywhere.
    if (ctx.propId['Budgeted Amount']) {
      writes.push({ propertyId: ctx.propId['Budgeted Amount'], value: stored });
    }

    for (const w of writes) {
      await prisma.propertyValue.upsert({
        where: { propertyId_pageId: { propertyId: w.propertyId, pageId } },
        create: { propertyId: w.propertyId, pageId, value: w.value },
        update: { value: w.value },
      });
    }

    return NextResponse.json({ ok: true, pageId, category, amount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
