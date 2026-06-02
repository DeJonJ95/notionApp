import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';
import {
  ANALYZE_SYSTEM,
  buildAnalyzeUser,
  callDeepSeek,
  parseAnalysis,
} from '@/lib/jobs/deepseek';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Scan one listing against the user's resumes and persist the analysis
// (1:1, regenerable — re-running replaces it).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const listing = await prisma.jobListing.findFirst({
    where: { id: params.id, userId },
    select: { id: true, title: true, company: true, description: true },
  });
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const resumes = await prisma.resume.findMany({
    where: { userId },
    select: { id: true, label: true, parsedText: true },
    orderBy: { createdAt: 'asc' },
  });
  if (resumes.length === 0) {
    return NextResponse.json({ error: 'Upload at least one resume first' }, { status: 400 });
  }

  try {
    const { content, usage } = await callDeepSeek(
      apiKey,
      ANALYZE_SYSTEM,
      buildAnalyzeUser(listing, resumes),
      { json: true, maxTokens: 2500 },
    );
    if (usage) logDeepSeek('applykit-analyze', usage, userId);

    const result = parseAnalysis(content);
    // Guard against the model recommending a resume id that isn't ours.
    const validIds = new Set(resumes.map((r) => r.id));
    if (!validIds.has(result.recommendedResumeId)) {
      const best = [...result.scores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      result.recommendedResumeId = validIds.has(best?.resumeId) ? best.resumeId : resumes[0].id;
    }

    const analysis = await prisma.analysis.upsert({
      where: { listingId: listing.id },
      create: {
        listingId: listing.id,
        keywords: result.keywords,
        requirements: result.requirements,
        recommendedResumeId: result.recommendedResumeId,
        scores: result.scores,
        suggestedTweaks: result.suggestedTweaks,
        gaps: result.gaps,
        atsNotes: result.atsNotes,
      },
      update: {
        keywords: result.keywords,
        requirements: result.requirements,
        recommendedResumeId: result.recommendedResumeId,
        scores: result.scores,
        suggestedTweaks: result.suggestedTweaks,
        gaps: result.gaps,
        atsNotes: result.atsNotes,
        createdAt: new Date(),
      },
    });

    return NextResponse.json({ analysis });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Analysis failed' }, { status: 502 });
  }
}
