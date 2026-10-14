import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';
import { callDeepSeek } from '@/lib/jobs/deepseek';
import { PRACTICE_SYSTEM, buildPracticeUser, parsePractice } from '@/lib/jobs/prep';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  q: z.string().min(3).max(500),
  why: z.string().max(1000).default(''),
  answer: z.string().min(20, 'Write a few sentences first').max(6000),
});

function prepResumeId(prep: unknown): string | null {
  if (!prep || typeof prep !== 'object' || !('resumeId' in prep)) return null;
  return typeof prep.resumeId === 'string' ? prep.resumeId : null;
}

// Coach feedback on one practice answer. Not stored: practice is scratch work.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { title: true, company: true, prep: true },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const resumeId = prepResumeId(listing.prep);
  const resume = await prisma.resume.findFirst({
    where: { userId, ...(resumeId ? { id: resumeId } : {}) },
    select: { parsedText: true },
    orderBy: { createdAt: 'asc' },
  });

  try {
    const { q, why, answer } = parsed.data;
    const { content, usage } = await callDeepSeek(
      apiKey,
      PRACTICE_SYSTEM,
      buildPracticeUser(listing, { q, why }, answer, resume?.parsedText ?? ''),
      { json: true, maxTokens: 900, temperature: 0.3, timeoutMs: 40_000 },
    );
    if (usage) logDeepSeek('applykit-practice', usage, userId);
    return NextResponse.json({ feedback: parsePractice(content) });
  } catch {
    return NextResponse.json({ error: 'Could not get feedback. Try again.' }, { status: 502 });
  }
}
