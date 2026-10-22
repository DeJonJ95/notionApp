import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { getBytes, putBytes, deleteObject } from '@/lib/r2';
import { logCall, logDeepSeek } from '@/lib/logUsage';
import { callDeepSeek, RECRUITER_MSG_SYSTEM, buildRecruiterMsgUser } from '@/lib/jobs/deepseek';
import { tailorFromDocx, tailorFromText, type TailorOutput } from '@/lib/jobs/tailorRun';
import { plainDashes } from '@/lib/prose';
import { DOCX_MIME } from '@/lib/jobs/resumeFiles';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  resumeId: z.string().min(1),
  tweaks: z
    .array(z.object({ original: z.string(), rewrite: z.string() }))
    .max(40)
    .default([]),
});

type Job = { title: string; company: string; description: string };
type Resume = { r2Key: string; parsedText: string; fileType: string };

const downloadUrl = (key: string | null) => (key ? `/api/files/download?key=${encodeURIComponent(key)}` : null);

function keywordsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

async function runTailor(resume: Resume, tweaks: z.infer<typeof bodySchema>['tweaks'], job: { title: string; keywords: string[] }) {
  if (resume.fileType !== 'docx') return tailorFromText(resume.parsedText, tweaks, job);
  return tailorFromDocx(await getBytes(resume.r2Key), tweaks, job);
}

async function storeFiles(out: TailorOutput, base: string) {
  const styledKey = out.styled ? `${base}.docx` : null;
  const atsKey = `${base}-ats.docx`;
  if (out.styled && styledKey) await putBytes(styledKey, out.styled, DOCX_MIME);
  await putBytes(atsKey, out.plain, DOCX_MIME);
  return { styledKey, atsKey };
}

// Best-effort: a failed outreach message must not fail the tailoring.
async function recruiterMessage(job: Job, resumeText: string, userId: string): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  try {
    const { content, usage } = await callDeepSeek(apiKey, RECRUITER_MSG_SYSTEM, buildRecruiterMsgUser(job, resumeText), {
      maxTokens: 220,
      temperature: 0.5,
    });
    if (usage) logDeepSeek('applykit-recruiter-msg', usage, userId);
    return plainDashes(content.trim()) || null;
  } catch {
    return null;
  }
}

// Apply the approved tweaks, store the styled and ATS-safe files plus the ATS
// report on the JobApplication, and drop the files they replace (at most one
// set per application). Unlocated tweaks come back so the UI can flag them.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, field: true, title: true, company: true, description: true, analysis: { select: { keywords: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { resumeId, tweaks } = parsed.data;

  const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId }, select: { r2Key: true, parsedText: true, fileType: true } });
  if (!resume) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });

  const pendingMessage = recruiterMessage(listing, resume.parsedText, userId);
  let out: TailorOutput;
  try {
    out = await runTailor(resume, tweaks, { title: listing.title, keywords: keywordsOf(listing.analysis?.keywords) });
  } catch {
    return NextResponse.json({ error: 'Could not tailor that resume' }, { status: 422 });
  }

  const prev = await prisma.jobApplication.findUnique({ where: { listingId: listing.id }, select: { tailoredR2Key: true, atsR2Key: true } });
  const { styledKey, atsKey } = await storeFiles(out, `${userId}/tailored/${listing.id}-${Date.now()}`);
  const message = await pendingMessage;

  const files = { resumeId, tailoredR2Key: styledKey, atsR2Key: atsKey, atsReport: out.report, recruiterMessage: message };
  const application = await prisma.jobApplication.upsert({
    where: { listingId: listing.id },
    create: { userId, listingId: listing.id, field: listing.field, status: 'SAVED', ...files },
    update: files,
    select: { id: true, tailoredR2Key: true, atsR2Key: true, status: true },
  });

  await Promise.all([prev?.tailoredR2Key, prev?.atsR2Key].filter((k): k is string => !!k).map((k) => deleteObject(k).catch(() => {})));

  logCall('applykit', 'tailor', { userId });
  return NextResponse.json({
    application,
    applied: out.applied,
    unmatched: out.unmatched,
    recruiterMessage: message,
    report: out.report,
    tailoredFile: !!styledKey,
    downloadUrl: downloadUrl(styledKey),
    atsUrl: downloadUrl(atsKey),
  });
}
