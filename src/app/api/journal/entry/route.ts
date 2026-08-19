import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Look up a journal entry by date — does NOT auto-create.
// Returns { pageId } if found, or { pageId: null } if no entry exists.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  // Build the same title format as the today route.
  const [y, m, d] = dateParam.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const title = `Journal — ${date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}`;

  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: userId, name: { equals: 'Daily Journals', mode: 'insensitive' } },
  });

  if (!workspace) return NextResponse.json({ pageId: null });

  const page = await prisma.page.findFirst({
    where: { workspaceId: workspace.id, title, isArchived: false },
    select: { id: true },
  });

  return NextResponse.json({ pageId: page?.id ?? null });
}