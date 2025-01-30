import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function tableMissing(e: any) {
  return e?.message?.includes('does not exist') || e?.code === 'P2021';
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
    return NextResponse.json(goals);
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
