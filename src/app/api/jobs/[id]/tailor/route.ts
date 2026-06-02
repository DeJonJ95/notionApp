import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBytes, putBytes } from '@/lib/r2';
import { tailorDocx } from '@/lib/jobs/docx';
import { logCall } from '@/lib/logUsage';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const bodySchema = z.object({
  resumeId: z.string().min(1),
  tweaks: z
    .array(z.object({ original: z.string(), rewrite: z.string() }))
    .max(40)
    .default([]),
});

// Apply the user-approved tweaks to the chosen base resume, store the tailored
// .docx, and upsert the JobApplication that holds it. Returns which tweaks
// couldn't be located so the UI can flag them instead of silently dropping.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, field: true },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const resume = await prisma.resume.findFirst({
    where: { id: parsed.data.resumeId, userId },
    select: { r2Key: true },
  });
  if (!resume) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });

  let result: { bytes: Buffer; applied: number; unmatched: { original: string; rewrite: string }[] };
  try {
    const original = await getBytes(resume.r2Key);
    result = tailorDocx(original, parsed.data.tweaks);
  } catch {
    return NextResponse.json({ error: 'Could not tailor that resume' }, { status: 422 });
  }

  const tailoredR2Key = `${userId}/tailored/${listing.id}-${Date.now()}.docx`;
  await putBytes(tailoredR2Key, result.bytes, DOCX_MIME);

  const application = await prisma.jobApplication.upsert({
    where: { listingId: listing.id },
    create: {
      userId,
      listingId: listing.id,
      resumeId: parsed.data.resumeId,
      tailoredR2Key,
      field: listing.field,
      status: 'SAVED',
    },
    update: { resumeId: parsed.data.resumeId, tailoredR2Key },
    select: { id: true, tailoredR2Key: true, status: true },
  });

  logCall('applykit', 'tailor', { userId });
  return NextResponse.json({
    application,
    applied: result.applied,
    unmatched: result.unmatched,
    downloadUrl: `/api/files/download?key=${encodeURIComponent(tailoredR2Key)}`,
  });
}
