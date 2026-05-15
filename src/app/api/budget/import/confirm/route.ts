import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { writeTransactions, type ParsedTransaction } from '@/lib/budgetDb';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { databaseId, transactions } = (await req.json()) as {
    databaseId: string;
    transactions: ParsedTransaction[];
  };

  if (!databaseId || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'databaseId and transactions required' }, { status: 400 });
  }

  try {
    const result = await writeTransactions(userId, databaseId, transactions);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
  }
}
