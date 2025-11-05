import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type ImportLogEntry = {
  id: string;
  filename: string;
  dateFrom: string;
  dateTo: string;
  txCount: number;
  createdAt: string;
};

export type ImportsPayload = {
  imports: ImportLogEntry[];
  lastImportDate: string | null;
  daysSinceLastImport: number | null;
  gaps: { from: string; to: string; days: number }[];
};

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const logs = await prisma.importLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const entries: ImportLogEntry[] = logs.map((l) => ({
    id: l.id,
    filename: l.filename,
    dateFrom: l.dateFrom.toISOString().slice(0, 10),
    dateTo: l.dateTo.toISOString().slice(0, 10),
    txCount: l.txCount,
    createdAt: l.createdAt.toISOString().slice(0, 10),
  }));

  const now = new Date();
  let lastImportDate: string | null = null;
  let daysSinceLastImport: number | null = null;

  if (entries.length > 0) {
    const last = logs[0];
    lastImportDate = last.createdAt.toISOString().slice(0, 10);
    const diffMs = now.getTime() - last.createdAt.getTime();
    daysSinceLastImport = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Compute coverage gaps: gaps > 3 days between import date ranges
  const gaps: { from: string; to: string; days: number }[] = [];
  if (entries.length >= 2) {
    // Sort chronologically ascending for gap detection
    const sorted = [...logs].sort(
      (a, b) => a.dateFrom.getTime() - b.dateFrom.getTime()
    );
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].dateTo;
      const currStart = sorted[i].dateFrom;
      const gapMs = currStart.getTime() - prevEnd.getTime();
      const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24)) - 1;
      if (gapDays > 3) {
        gaps.push({
          from: new Date(prevEnd.getTime() + 86400000).toISOString().slice(0, 10),
          to: new Date(currStart.getTime() - 86400000).toISOString().slice(0, 10),
          days: gapDays,
        });
      }
    }
  }

  const payload: ImportsPayload = {
    imports: entries,
    lastImportDate,
    daysSinceLastImport,
    gaps,
  };

  return NextResponse.json(payload);
}