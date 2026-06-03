import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBytes, putBytes } from '@/lib/r2';
import { tailorDocx } from '@/lib/jobs/docx';
import { logCall, logDeepSeek } from '@/lib/logUsage';
import { callDeepSeek, RECRUITER_MSG_SYSTEM, buildRecruiterMsgUser } from '@/lib/jobs/deepseek';
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
    select: { id: true, field: true, title: true, company: true, description: true },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const resume = await prisma.resume.findFirst({
    where: { id: parsed.data.resumeId, userId },
    select: { r2Key: true, parsedText: true, fileType: true },
  });
  if (!resume) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });

  // Surgical in-place editing only works for .docx. PDF resumes can't be edited
  // without reflowing, so for a PDF we skip the file and the user applies the
  // approved tweaks manually (the recruiter message + tracking still run).
  let applied = 0;
  let unmatched: { original: string; rewrite: string }[] = [];
  let tailoredR2Key: string | null = null;
  if (resume.fileType === 'docx') {
    let result: { bytes: Buffer; applied: number; unmatched: { original: string; rewrite: string }[] };
    try {
      const original = await getBytes(resume.r2Key);
      result = tailorDocx(original, parsed.data.tweaks);
    } catch {
      return NextResponse.json({ error: 'Could not tailor that resume' }, { status: 422 });
    }
    applied = result.applied;
    unmatched = result.unmatched;
    tailoredR2Key = `${userId}/tailored/${listing.id}-${Date.now()}.docx`;
    await putBytes(tailoredR2Key, result.bytes, DOCX_MIME);
  }

  // Generate a short LinkedIn-recruiter outreach message from the same
  // resume + job. Best-effort: a failure here shouldn't fail the tailoring.
  let recruiterMessage: string | null = null;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    try {
      const { content, usage } = await callDeepSeek(
        apiKey,
        RECRUITER_MSG_SYSTEM,
        buildRecruiterMsgUser(
          { title: listing.title, company: listing.company, description: listing.description },
          resume.parsedText,
        ),
        { maxTokens: 220, temperature: 0.5 },
      );
      recruiterMessage = content.trim() || null;
      if (usage) logDeepSeek('applykit-recruiter-msg', usage, userId);
    } catch {
      // leave recruiterMessage null; the tailored resume still succeeds
    }
  }

  const application = await prisma.jobApplication.upsert({
    where: { listingId: listing.id },
    create: {
      userId,
      listingId: listing.id,
      resumeId: parsed.data.resumeId,
      tailoredR2Key,
      recruiterMessage,
      field: listing.field,
      status: 'SAVED',
    },
    update: { resumeId: parsed.data.resumeId, tailoredR2Key, recruiterMessage },
    select: { id: true, tailoredR2Key: true, status: true },
  });

  logCall('applykit', 'tailor', { userId });
  return NextResponse.json({
    application,
    applied,
    unmatched,
    recruiterMessage,
    tailoredFile: !!tailoredR2Key,
    downloadUrl: tailoredR2Key ? `/api/files/download?key=${encodeURIComponent(tailoredR2Key)}` : null,
  });
}
