import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findOrCreateBudgetDb, goalLedgerAmounts } from '@/lib/budgetDb';

function tableMissing(e: any) {
  return e?.message?.includes('does not exist') || e?.code === 'P2021';
}

/** Sum each goal's Type='Savings' transactions. Best-effort: a failure here
 *  must not stop the goals list from loading. */
async function loadGoalLedger(
  userId: string,
  goals: { id: string; name: string }[],
): Promise<Record<string, number>> {
  if (goals.length === 0) return {};
  try {
    const db = await findOrCreateBudgetDb(userId);
    const pages = await prisma.page.findMany({
      where: { databaseId: db.id, isArchived: false },
      include: { properties: { include: { property: { select: { name: true } } } } },
    });
    const savings: { text: string; amount: number }[] = [];
    for (const p of pages) {
      const vals: Record<string, any> = {};
      for (const pv of p.properties) vals[pv.property.name] = pv.value;
      if (String(vals['Type'] ?? '') !== 'Savings') continue;
      const amount = Number(vals['Amount'] ?? 0);
      if (!amount) continue;
      savings.push({
        text: `${vals['Vendor'] ?? p.title ?? ''} ${vals['Notes'] ?? ''}`,
        amount,
      });
    }
    return goalLedgerAmounts(goals, savings);
  } catch (e) {
    console.warn('[budget-goals] ledger progress skipped:', (e as Error).message);
    return {};
  }
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const goals = await prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    // Money already moved in the ledger counts too. `currentAmount` stays the
    // user's own manual figure; `ledgerAmount` is reported alongside it.
    const ledger = await loadGoalLedger(userId, goals);
    return NextResponse.json(goals.map((g) => ({ ...g, ledgerAmount: ledger[g.id] ?? 0 })));
  } catch (e: any) {
    if (tableMissing(e)) return NextResponse.json({ error: 'SavingsGoal table missing — run migration SQL.' }, { status: 503 });
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  const targetAmount = Number(body.targetAmount);
  const currentAmount = Number(body.currentAmount ?? 0);
  if (!name || isNaN(targetAmount) || targetAmount <= 0) {
    return NextResponse.json({ error: 'name and positive targetAmount required' }, { status: 400 });
  }
  const deadline = body.deadline ? new Date(body.deadline) : null;

  try {
    const goal = await prisma.savingsGoal.create({
      data: {
        userId,
        name,
        targetAmount,
        currentAmount: isNaN(currentAmount) ? 0 : Math.max(0, currentAmount),
        deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
      },
    });
    return NextResponse.json(goal);
  } catch (e: any) {
    if (tableMissing(e)) return NextResponse.json({ error: 'SavingsGoal table missing — run migration SQL.' }, { status: 503 });
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
