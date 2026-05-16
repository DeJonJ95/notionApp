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

  try {
    const rule = await prisma.categorizationRule.upsert({
      where: { userId_match: { userId, match } },
      update: { category },
      create: { userId, match, category },
    });
    return NextResponse.json(rule);
  } catch (e: any) {
    if (tableMissing(e)) return NextResponse.json({ error: 'CategorizationRule table missing — run migration SQL.' }, { status: 503 });
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
