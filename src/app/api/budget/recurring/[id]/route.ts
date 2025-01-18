import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let existing;
  try {
    existing = await prisma.recurringRule.findFirst({
      where: { id: params.id, userId },
    });
  } catch (e: any) {
    if (e?.message?.includes('does not exist') || e?.code === 'P2021') {
      return NextResponse.json({ error: 'RecurringRule table missing — run the migration SQL in Neon.' }, { status: 503 });
    }
    return NextResponse.json({ error: e?.message ?? 'DB error' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const data: Record<string, any> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (typeof body.category === 'string') data.category = body.category.trim();
  if (body.amount !== undefined) {
    const amt = Number(body.amount);
    if (!isNaN(amt) && amt > 0) data.amount = amt;
  }
  if (['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(body.frequency)) {
    data.frequency = body.frequency;
  }
  if (['income', 'expense'].includes(body.type)) {
    data.type = body.type;
  }
  if (body.anchorDate) {
    const d = new Date(body.anchorDate);
    if (!isNaN(d.getTime())) data.anchorDate = d;
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  const updated = await prisma.recurringRule.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await prisma.recurringRule.findFirst({
    where: { id: params.id, userId },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.recurringRule.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
