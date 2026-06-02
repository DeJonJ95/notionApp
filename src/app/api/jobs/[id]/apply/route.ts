import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// Mark a listing as applied. Called by the user ("Mark as applied") or the
// extension after autofill+submit. Creates the application if the user
// skipped tailoring, and records the status transition in the timeline.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, field: true, application: { select: { id: true, status: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const now = new Date();
  let applicationId = listing.application?.id;
  const fromStatus = listing.application?.status ?? null;

  if (applicationId) {
    await prisma.jobApplication.update({
      where: { id: applicationId },
      data: { status: 'APPLIED', appliedAt: now },
    });
  } else {
    const created = await prisma.jobApplication.create({
      data: {
        userId,
        listingId: listing.id,
        field: listing.field,
        status: 'APPLIED',
        appliedAt: now,
      },
      select: { id: true },
    });
    applicationId = created.id;
  }

  await prisma.applicationEvent.create({
    data: { applicationId, fromStatus, toStatus: 'APPLIED', note: 'Marked as applied' },
  });

  return NextResponse.json({ ok: true, applicationId });
}
