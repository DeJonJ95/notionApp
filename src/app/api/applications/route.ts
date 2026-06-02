import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// Tracker feed: every application with its listing + status timeline.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const applications = await prisma.jobApplication.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      listing: { select: { id: true, company: true, title: true, sourceUrl: true, applyUrl: true, compMin: true, compMax: true } },
      resume: { select: { id: true, label: true } },
      events: { orderBy: { createdAt: 'desc' } },
    },
  });
  return NextResponse.json({ applications });
}
