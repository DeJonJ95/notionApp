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
    const rules = await prisma.categorizationRule.findMany({
      where: { userId },
      orderBy: { match: 'asc' },
    });
    return NextResponse.json(rules);
  } catch (e: any) {
    if (tableMissing(e)) return NextResponse.json({ error: 'CategorizationRule table missing — run migration SQL.' }, { status: 503 });
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const match = String(body.match ?? '').trim().toLowerCase();
  const category = String(body.category ?? '').trim();
  if (!match || !category) return NextResponse.json({ error: 'match and category required' }, { status: 400 });

  const bound = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Math.abs(Number(v));
    return Number.isFinite(n) ? n : null;
  };
  const minAmount = bound(body.minAmount);
  const maxAmount = bound(body.maxAmount);
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
    return NextResponse.json({ error: 'Minimum cannot be more than the maximum' }, { status: 400 });
  }

  try {
    // The same vendor text can carry several rules that differ by amount band,
    // so identity is (match + bounds) rather than match alone.
    const existing = await prisma.categorizationRule.findFirst({
      where: { userId, match, minAmount, maxAmount },
    });
    const rule = existing
      ? await prisma.categorizationRule.update({
          where: { id: existing.id },
          data: { category },
        })
      : await prisma.categorizationRule.create({
          data: { userId, match, category, minAmount, maxAmount },
        });
    return NextResponse.json(rule);
  } catch (e: any) {
    if (tableMissing(e)) return NextResponse.json({ error: 'CategorizationRule table missing — run migration SQL.' }, { status: 503 });
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
