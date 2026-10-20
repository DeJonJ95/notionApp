import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  writeTransactions,
  findDuplicateTransactions,
  type ParsedTransaction,
} from '@/lib/budgetDb';
import { num, statementRange } from '@/lib/budgetStatement';
import { loadLedger } from '@/lib/budgetLedger';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { databaseId, transactions, force, account, meta } = (await req.json()) as {
    databaseId: string;
    transactions: ParsedTransaction[];
    force?: boolean;
    account?: string;
    meta?: { account?: string | null; openingBalance?: number | null; closingBalance?: number | null; periodStart?: string | null; periodEnd?: string | null };
  };

  if (!databaseId || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'databaseId and transactions required' }, { status: 400 });
  }

  // The account the user confirmed in the preview wins over what the AI read.
  const accountName = String(account ?? meta?.account ?? '').trim().slice(0, 80);
  const stamped: ParsedTransaction[] = accountName
    ? transactions.map((t) => ({ ...t, account: accountName }))
    : transactions;

  // The dates this statement is the record for; overdue bills are judged against them.
  const range = statementRange(meta, transactions.map((t) => String(t.date ?? '')));

  try {
    if (!force) {
      const db = await prisma.database.findFirst({
        where: { id: databaseId, workspace: { ownerId: userId } },
        select: { id: true },
      });
      if (db) {
        const { all } = await loadLedger(db.id);
        const existing = all.filter((t) => !t.planned);
        const duplicates = findDuplicateTransactions(existing, transactions);
        if (duplicates.length > 0) {
          return NextResponse.json({ duplicates, created: 0 });
        }
      }
    }

    const result = await writeTransactions(userId, databaseId, stamped);

    if (range) {
      await prisma.importLog.create({
        data: {
          userId,
          filename: `import-${range.from}-to-${range.to}`,
          dateFrom: new Date(range.from + 'T00:00:00Z'),
          dateTo: new Date(range.to + 'T00:00:00Z'),
          txCount: transactions.length,
          account: accountName || null,
          openingBalance: num(meta?.openingBalance),
          closingBalance: num(meta?.closingBalance),
        },
      });
    }

    return NextResponse.json({ ...result, duplicates: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
  }
}