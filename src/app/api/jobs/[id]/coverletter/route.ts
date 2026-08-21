import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { putBytes, deleteObject } from '@/lib/r2';
import { logDeepSeek } from '@/lib/logUsage';
import { callDeepSeek, COVER_LETTER_SYSTEM, buildCoverLetterUser } from '@/lib/jobs/deepseek';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, title: true, company: true, description: true },
  });
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resumeId = body.resumeId;
  if (!resumeId) return NextResponse.json({ error: 'resumeId required' }, { status: 400 });

  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId },
    select: { id: true, parsedText: true },
  });
  if (!resume) return NextResponse.json({ error: 'Resume not found' }, { status: 404 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const { content, usage } = await callDeepSeek(
    apiKey,
    COVER_LETTER_SYSTEM,
    buildCoverLetterUser(listing, resume.parsedText),
    { maxTokens: 900, temperature: 0.4 },
  );
  if (usage) logDeepSeek('applykit-coverletter', usage, userId);

  const letterText = content.trim();
  if (!letterText) return NextResponse.json({ error: 'Generation failed' }, { status: 502 });

  const txtKey = `${userId}/coverletters/${listing.id}-${Date.now()}.txt`;
  await putBytes(txtKey, Buffer.from(letterText, 'utf-8'), 'text/plain');

  const prev = await prisma.jobApplication.findUnique({
    where: { listingId: listing.id },
    select: { coverLetterR2Key: true },
  });
  if (prev?.coverLetterR2Key && prev.coverLetterR2Key !== txtKey) {
    await deleteObject(prev.coverLetterR2Key).catch(() => {});
  }

  const application = await prisma.jobApplication.upsert({
    where: { listingId: listing.id },
    create: {
      userId,
      listingId: listing.id,
      resumeId,
      coverLetterR2Key: txtKey,
      status: 'SAVED',
    },
    update: { resumeId, coverLetterR2Key: txtKey },
    select: { id: true, coverLetterR2Key: true },
  });

  return NextResponse.json({
    application,
    letterText,
    downloadUrl: `/api/files/download?key=${encodeURIComponent(txtKey)}`,
  });
}
