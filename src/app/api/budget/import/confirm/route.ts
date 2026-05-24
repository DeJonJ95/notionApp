import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeTransactions, findDuplicateTransactions, type ParsedTransaction } from '@/lib/budgetDb';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { databaseId, transactions, force } = (await req.json()) as {
    databaseId: string;
    transactions: ParsedTransaction[];
    force?: boolean;
  };

  if (!databaseId || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'databaseId and transactions required' }, { status: 400 });
  }

  try {
    // ── Cross-import dedup check ───────────────────────────────────────────
    if (!force) {
      // Load existing transactions from the budget DB for duplicate matching
      const db = await prisma.database.findFirst({
        where: { id: databaseId, workspace: { ownerId: userId } },
        include: { properties: true },
      });
      if (db) {
        const pages = await prisma.page.findMany({
          where: { databaseId: db.id, isArchived: false },
          include: { properties: { include: { property: { select: { name: true } } } } },
        });
        const existing: { date: string; vendor: string; amount: number }[] = [];
        for (const p of pages) {
          const vals: Record<string, any> = {};
          for (const pv of p.properties) vals[pv.property.name] = pv.value;
          const type = String(vals['Type'] ?? '');
          if (type === 'Budget') continue;
          const rawAmt = Number(vals['Amount'] ?? 0);
          if (!rawAmt) continue;
          existing.push({
            date: String(vals['Date'] ?? '').slice(0, 10),
            vendor: String(vals['Vendor'] ?? p.title ?? ''),
            amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
          });
        }
        const duplicates = findDuplicateTransactions(existing, transactions);
        if (duplicates.length > 0) {
          return NextResponse.json({ duplicates, created: 0 });
        }
      }
    }

    // ── Write transactions ─────────────────────────────────────────────────
    const result = await writeTransactions(userId, databaseId, transactions);

    // ── Create ImportLog entry ─────────────────────────────────────────────
    const dates = transactions
      .map((t) => new Date(t.date + 'T00:00:00'))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    if (dates.length > 0) {
      await prisma.importLog.create({
        data: {
          userId,
          filename: `import-${dates[0].toISOString().slice(0, 10)}-to-${dates[dates.length - 1].toISOString().slice(0, 10)}`,
          dateFrom: dates[0],
          dateTo: dates[dates.length - 1],
          txCount: transactions.length,
        },
      });
    }

    return NextResponse.json({ ...result, duplicates: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
  }
}