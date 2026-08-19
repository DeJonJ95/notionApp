import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Parse "Journal — Thursday, August 19, 2026" → "2026-08-19"
const MONTH_MAP: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};
const TITLE_RE = /^Journal — \w+, (\w+) (\d+), (\d+)$/;

function parseJournalDate(title: string): string | null {
  const m = title.match(TITLE_RE);
  if (!m) return null;
  const month = MONTH_MAP[m[1]];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[2]).padStart(2, '0')}`;
}

// Returns all dates that have journal pages for the current user,
// sorted newest-first. Queries the journal Pages directly (rather than
// the JournalEntry index) so old entries that predate the JournalEntry
// model still appear in the calendar.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  // Find the "Daily Journals" workspace for this user.
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: userId, name: { equals: 'Daily Journals', mode: 'insensitive' } },
  });
  if (!workspace) return NextResponse.json({ dates: [] });

  // Grab every non-archived page in that workspace.
  const pages = await prisma.page.findMany({
    where: { workspaceId: workspace.id, isArchived: false },
    select: { id: true, title: true },
  });

  // Parse the date from each journal title.
  const dates: { date: string; pageId: string }[] = [];
  for (const p of pages) {
    const date = parseJournalDate(p.title);
    if (date) dates.push({ date, pageId: p.id });
  }

  // Newest first.
  dates.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({ dates });
}