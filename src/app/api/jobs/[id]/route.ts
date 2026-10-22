import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/r2';

export const runtime = 'nodejs';

// Remove a captured job. The analysis, application, and its events all
// cascade-delete with the listing (see schema.prisma onDelete: Cascade), so a
// single delete cleans up the whole pipeline. Generated files live in R2, so
// they are cleared separately on a best-effort basis.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, application: { select: { tailoredR2Key: true, atsR2Key: true, coverLetterR2Key: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const app = listing.application;
  const keys = [app?.tailoredR2Key, app?.atsR2Key, app?.coverLetterR2Key].filter((k): k is string => !!k);
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));

  await prisma.jobListing.delete({ where: { id: listing.id } });
  return NextResponse.json({ ok: true });
}
