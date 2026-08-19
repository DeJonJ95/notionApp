import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Returns all dates that have journal entries for the current user,
// sorted newest-first. Used by the calendar to highlight dates with entries.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const entries = await prisma.journalEntry.findMany({
    where: { userId },
    select: { date: true, pageId: true },
    orderBy: { date: 'desc' },
  });

  // Serialize dates to YYYY-MM-DD strings for the client.
  const dates = entries.map((e) => ({
    date: e.date.toISOString().split('T')[0],
    pageId: e.pageId,
  }));

  return NextResponse.json({ dates });
}