import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/r2';

export const runtime = 'nodejs';

// Remove a captured job. The analysis, application, and its events all
// cascade-delete with the listing (see schema.prisma onDelete: Cascade), so a
// single delete cleans up the whole pipeline. The tailored resume lives in R2,
// so we clear it separately on a best-effort basis.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, application: { select: { tailoredR2Key: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tailoredKey = listing.application?.tailoredR2Key;
  if (tailoredKey) await deleteObject(tailoredKey).catch(() => {});

  await prisma.jobListing.delete({ where: { id: listing.id } });
  return NextResponse.json({ ok: true });
}
