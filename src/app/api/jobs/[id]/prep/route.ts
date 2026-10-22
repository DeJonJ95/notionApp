import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { logCall, logDeepSeek } from '@/lib/logUsage';
import { callDeepSeek } from '@/lib/jobs/deepseek';
import { PREP_PARTS, PREP_SYSTEM, buildPrepUser, parsePrep, type InterviewPrep } from '@/lib/jobs/prep';

export const runtime = 'nodejs';
export const maxDuration = 60;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

// The resume the candidate is interviewing with: the one they asked for, else
// the one they tailored, else the analysis pick, else their first.
async function pickResume(userId: string, preferred: (string | null | undefined)[]) {
  const resumes = await prisma.resume.findMany({
    where: { userId },
    select: { id: true, label: true, parsedText: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const id of preferred) {
    const hit = resumes.find((r) => r.id === id);
    if (hit) return hit;
  }
  return resumes[0] ?? null;
}

// Build (or rebuild) the interview prep pack for one job and store it on the
// listing, so it survives reloads and the user can practice against it.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: {
      id: true, title: true, company: true, description: true,
      analysis: { select: { requirements: true, gaps: true, recommendedResumeId: true } },
      application: { select: { resumeId: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = await pickResume(userId, [body?.resumeId, listing.application?.resumeId, listing.analysis?.recommendedResumeId]);
  if (!resume) return NextResponse.json({ error: 'Upload a resume first' }, { status: 400 });

  const extra = { requirements: strings(listing.analysis?.requirements), gaps: strings(listing.analysis?.gaps) };
  try {
    const settled = await Promise.allSettled(
      PREP_PARTS.map((part) =>
        callDeepSeek(apiKey, PREP_SYSTEM, buildPrepUser(part, listing, resume.parsedText, extra), {
          json: true, maxTokens: 3200, temperature: 0.4, timeoutMs: 50_000,
        }),
      ),
    );
    const results = settled.map((s) => (s.status === 'fulfilled' ? s.value : { content: '', usage: undefined }));
    results.forEach((r) => r.usage && logDeepSeek('applykit-prep', r.usage, userId));
    const pack = parsePrep(results.map((r) => r.content));
    if (!pack.questions.length) throw new Error('The model returned no questions. Try again.');

    const prep: InterviewPrep = { ...pack, resumeId: resume.id, resumeLabel: resume.label, createdAt: new Date().toISOString() };
    await prisma.jobListing.update({ where: { id: listing.id }, data: { prep } });
    logCall('applykit', 'prep', { userId });
    return NextResponse.json({ prep });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    const message = timedOut ? 'Prep took too long. Try again.' : e instanceof Error ? e.message : 'Prep failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
