import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await prisma.savingsGoal.findFirst({ where: { id: params.id, userId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (body.targetAmount !== undefined) {
    const t = Number(body.targetAmount);
    if (!isNaN(t) && t > 0) data.targetAmount = t;
  }
  if (body.currentAmount !== undefined) {
    const c = Number(body.currentAmount);
    if (!isNaN(c)) data.currentAmount = Math.max(0, c);
  }
  if (body.deadline !== undefined) {
    if (body.deadline === null) data.deadline = null;
    else {
      const d = new Date(body.deadline);
      if (!isNaN(d.getTime())) data.deadline = d;
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const updated = await prisma.savingsGoal.update({ where: { id: params.id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await prisma.savingsGoal.findFirst({ where: { id: params.id, userId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.savingsGoal.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
