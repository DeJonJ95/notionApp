import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ingestSchema, upsertListing } from '@/lib/jobs/ingest';

export const runtime = 'nodejs';

// List captured listings (newest first) with their analysis + application so
// the UI can render the whole pipeline in one fetch.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listings = await prisma.jobListing.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      analysis: true,
      application: { include: { events: { orderBy: { createdAt: 'desc' } } } },
    },
  });
  return NextResponse.json({ listings });
}

// Manual "Paste job" ingestion (session auth). The extension uses
// /api/jobs/ingest instead, but both share upsertListing.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const listing = await upsertListing(userId, parsed.data);
  return NextResponse.json({ listing });
}
