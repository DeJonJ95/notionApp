import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const VALID_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const;
const VALID_TYPES = ['income', 'expense'] as const;

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rules = await prisma.recurringRule.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { anchorDate: 'asc' }],
    });
    return NextResponse.json(rules);
  } catch (e: any) {
    // Most common cause: RecurringRule table doesn't exist yet (migration not run)
    console.error('[recurring GET] failed:', e?.message);
    if (e?.message?.includes('does not exist') || e?.code === 'P2021') {
      return NextResponse.json(
        { error: 'RecurringRule table missing — run the migration SQL in Neon (see commit notes).' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed to load rules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, name, category, amount, frequency, anchorDate } = body;

  if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  if (!VALID_FREQUENCIES.includes(frequency)) return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 });
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  if (!category?.trim()) return NextResponse.json({ error: 'Category required' }, { status: 400 });
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  const anchor = new Date(anchorDate);
  if (isNaN(anchor.getTime())) return NextResponse.json({ error: 'Invalid anchor date' }, { status: 400 });

  try {
    const rule = await prisma.recurringRule.create({
      data: {
        userId,
        type,
        name: name.trim(),
        category: category.trim(),
        amount: amt,
        frequency,
        anchorDate: anchor,
      },
    });
    return NextResponse.json(rule);
  } catch (e: any) {
    console.error('[recurring POST] failed:', e?.message);
    if (e?.message?.includes('does not exist') || e?.code === 'P2021') {
      return NextResponse.json(
        { error: 'RecurringRule table missing — run the migration SQL in Neon.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed to create rule' }, { status: 500 });
  }
}
