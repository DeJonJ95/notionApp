import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { onSchedule } from '@/lib/budgetExpected';

// The dialog shows the next due date, not the stored anchor. Saving that back
// must not move the anchor, which also marks where the rule's history starts.
function movedAnchor(existing: { anchorDate: Date; frequency: string }, frequency: string | undefined, raw: unknown): Date | null {
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  const sameSchedule = (frequency ?? existing.frequency) === existing.frequency && onSchedule(existing, d);
  return sameSchedule ? null : d;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    const anchor = movedAnchor(existing, data.frequency, body.anchorDate);
    if (anchor) data.anchorDate = anchor;
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  const updated = await prisma.recurringRule.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
