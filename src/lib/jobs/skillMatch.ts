// Free, deterministic first pass of job ranking: how many of a resume's own
// skills a posting mentions. The AI pass in rank.ts only spends tokens on the
// listings this puts at the top.

export type ResumeSkill = { name: string; aliases: string[] };

export type SkillResume = { id: string; label: string; skills: ResumeSkill[] };

export type SkillScore = { resumeId: string; label: string; score: number; matched: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${escape(t)}s?($|[^a-z0-9])`).test(text);
}

function found(text: string, skill: ResumeSkill): boolean {
  return [skill.name, ...skill.aliases].some((term) => mentions(text, term));
}

// Saturating curve: 2 skills ≈ 33, 5 ≈ 63, 8 ≈ 80, 12 ≈ 91. A skill in the
// job title counts twice, since the title is what the role is about.
export function overlapScore(hits: number): number {
  return Math.round(100 * (1 - Math.exp(-hits / 5)));
}

export function scoreResume(job: { title: string; description: string }, resume: SkillResume): SkillScore {
  const title = job.title.toLowerCase();
  const body = `${job.title}\n${job.description}`.toLowerCase();
  const matched = resume.skills.filter((s) => found(body, s)).map((s) => s.name);
  const titleHits = resume.skills.filter((s) => found(title, s)).length;
  return { resumeId: resume.id, label: resume.label, score: overlapScore(matched.length + titleHits), matched };
}

export function bestSkillMatch(
  job: { title: string; description: string },
  resumes: SkillResume[],
): SkillScore | null {
  const scored = resumes.map((r) => scoreResume(job, r));
  return scored.sort((a, b) => b.score - a.score)[0] ?? null;
}

export function readSkills(value: unknown): ResumeSkill[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((s): s is { name: unknown; aliases?: unknown } => !!s && typeof s === 'object' && 'name' in s)
    .map((s) => ({
      name: String(s.name).trim(),
      aliases: Array.isArray(s.aliases) ? s.aliases.map(String).filter(Boolean) : [],
    }))
    .filter((s) => s.name);
}
