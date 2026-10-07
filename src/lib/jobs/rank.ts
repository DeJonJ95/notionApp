import { prisma } from '@/lib/prisma';
import { bestSkillMatch, readSkills, type SkillResume } from './skillMatch';
import { extractSkills, quickScore } from './matchAi';

export type MatchResult = {
  resumeKey: string;
  resumeId: string;
  label: string;
  skillScore: number;
  matched: string[];
  aiScore: number | null;
  reason: string;
  missing: string;
  source: 'skills' | 'ai' | 'analysis';
};

type ResumeRow = { id: string; label: string; parsedText: string; skills: unknown };
type ListingRow = {
  id: string;
  title: string;
  company: string;
  description: string;
  match: unknown;
  analysis: { scores: unknown } | null;
};

export function readMatch(value: unknown): MatchResult | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<MatchResult>;
  return typeof m.resumeKey === 'string' && typeof m.skillScore === 'number' ? (m as MatchResult) : null;
}

// jsonb reorders keys on write, so compare with sorted keys or every run rewrites every row.
const stable = (v: unknown) => JSON.stringify(v, v && typeof v === 'object' ? Object.keys(v).sort() : undefined);

async function resumesWithSkills(userId: string, apiKey: string | undefined, rows: ResumeRow[]): Promise<SkillResume[]> {
  return Promise.all(
    rows.map(async (r) => {
      const cached = readSkills(r.skills);
      if (cached || !apiKey) return { id: r.id, label: r.label, skills: cached ?? [] };
      const skills = await extractSkills(apiKey, userId, r.parsedText).catch(() => null);
      if (skills) await prisma.resume.update({ where: { id: r.id }, data: { skills } });
      return { id: r.id, label: r.label, skills: skills ?? [] };
    }),
  );
}

// A full Analysis already holds a careful per-resume score, so it stands in
// for the quick AI score and the listing never costs a second call.
type AnalysisScore = { resumeId?: unknown; label?: unknown; score?: unknown; rationale?: unknown };

function fromAnalysis(analysis: ListingRow['analysis']): Partial<MatchResult> | null {
  const scores = Array.isArray(analysis?.scores) ? (analysis.scores as AnalysisScore[]) : [];
  const best = scores.filter((s) => typeof s.score === 'number').sort((a, b) => Number(b.score) - Number(a.score))[0];
  if (!best) return null;
  const owner = typeof best.resumeId === 'string' ? { resumeId: best.resumeId, label: String(best.label ?? '') } : {};
  return { ...owner, aiScore: Number(best.score), reason: String(best.rationale ?? ''), source: 'analysis' };
}

function skillPass(listing: ListingRow, resumes: SkillResume[], resumeKey: string): MatchResult {
  const skill = bestSkillMatch(listing, resumes);
  const base: MatchResult = {
    resumeKey,
    resumeId: skill?.resumeId ?? '',
    label: skill?.label ?? '',
    skillScore: skill?.score ?? 0,
    matched: skill?.matched ?? [],
    aiScore: null,
    reason: '',
    missing: '',
    source: 'skills',
  };
  const prev = readMatch(listing.match);
  if (prev && prev.resumeKey === resumeKey && prev.aiScore !== null) {
    return { ...base, resumeId: prev.resumeId, label: prev.label, aiScore: prev.aiScore, reason: prev.reason, missing: prev.missing, source: prev.source };
  }
  const analysed = fromAnalysis(listing.analysis);
  return analysed ? { ...base, ...analysed } : base;
}

export async function rankListings(userId: string, aiCount: number) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const resumeRows = await prisma.resume.findMany({
    where: { userId },
    select: { id: true, label: true, parsedText: true, skills: true },
    orderBy: { createdAt: 'asc' },
  });
  if (resumeRows.length === 0) return { ranked: 0, aiScored: 0, error: 'Upload at least one resume first' };

  const resumes = await resumesWithSkills(userId, apiKey, resumeRows);
  const resumeKey = resumeRows.map((r) => r.id).sort().join(',');
  const listings: ListingRow[] = await prisma.jobListing.findMany({
    where: { userId },
    select: { id: true, title: true, company: true, description: true, match: true, analysis: { select: { scores: true } } },
  });
  const next = new Map(listings.map((l) => [l.id, skillPass(l, resumes, resumeKey)]));

  const queue = apiKey
    ? listings.filter((l) => next.get(l.id)!.aiScore === null).sort((a, b) => next.get(b.id)!.skillScore - next.get(a.id)!.skillScore).slice(0, aiCount)
    : [];
  const labels = new Map(resumeRows.map((r) => [r.id, r.label]));
  const results = await Promise.allSettled(queue.map((l) => quickScore(apiKey!, userId, l, resumeRows)));
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const m = next.get(queue[i].id)!;
    const { resumeId, score, reason, missing } = r.value;
    next.set(queue[i].id, { ...m, resumeId, label: labels.get(resumeId) ?? m.label, aiScore: score, reason, missing, source: 'ai' });
  });

  const changed = listings.filter((l) => stable(l.match) !== stable(next.get(l.id)));
  await prisma.$transaction(changed.map((l) => prisma.jobListing.update({ where: { id: l.id }, data: { match: next.get(l.id)! } })));
  return { ranked: listings.length, aiScored: results.filter((r) => r.status === 'fulfilled').length, error: null };
}
