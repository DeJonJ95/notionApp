import { callDeepSeek } from './deepseek';
import { logDeepSeek } from '@/lib/logUsage';
import { readSkills, type ResumeSkill } from './skillMatch';

const SKILLS_SYSTEM = `You read a resume and list the concrete skills it demonstrates: tools, platforms, languages, channels, and specialist practices (for example "Mailchimp", "HTML email", "Salesforce Marketing Cloud", "A/B testing", "GovDelivery").
Rules:
- Only skills the resume actually shows. Never infer or add skills it does not mention.
- 15 to 40 entries, short canonical names. Skip soft skills like "communication" or "teamwork".
- For each, give the aliases a job posting might use instead (for example "SFMC" and "ExactTarget" for Salesforce Marketing Cloud). Empty list if none.
Return ONLY JSON: {"skills": [{"name": string, "aliases": string[]}]}`;

const QUICK_MATCH_SYSTEM = `You are a recruiter doing fast triage. Score how well the candidate's best resume fits a job, judging the concrete skills and experience the job asks for against what the resume shows. Do not reward generic overlap like "marketing" or "communication".
Return ONLY JSON: {"resumeId": string, "score": number, "reason": string, "missing": string}
- score is 0-100: 80+ strong fit, 60-79 worth applying, 40-59 stretch, under 40 poor fit.
- reason: one plain sentence under 20 words naming the specific skills that drive the score.
- missing: the single most important requirement the resume lacks, or "" if none.
- Plain prose. No em dashes. No "not X, but Y" phrasing.`;

function parseJsonObject(content: string): Record<string, unknown> {
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  return JSON.parse(s >= 0 && e > s ? content.slice(s, e + 1) : content);
}

export async function extractSkills(apiKey: string, userId: string, resumeText: string): Promise<ResumeSkill[]> {
  const { content, usage } = await callDeepSeek(apiKey, SKILLS_SYSTEM, `RESUME:\n"""\n${resumeText.slice(0, 9000)}\n"""`, {
    json: true,
    maxTokens: 1500,
  });
  if (usage) logDeepSeek('applykit-skills', usage, userId);
  return readSkills(parseJsonObject(content).skills) ?? [];
}

export type QuickScore = { resumeId: string; score: number; reason: string; missing: string };

export async function quickScore(
  apiKey: string,
  userId: string,
  job: { title: string; company: string; description: string },
  resumes: { id: string; label: string; parsedText: string }[],
): Promise<QuickScore> {
  const blocks = resumes.map((r) => `RESUME id=${r.id} label="${r.label}":\n"""\n${r.parsedText.slice(0, 4000)}\n"""`);
  const user = `JOB: ${job.title} @ ${job.company}\n"""\n${job.description.slice(0, 4000)}\n"""\n\n${blocks.join('\n\n')}`;
  const { content, usage } = await callDeepSeek(apiKey, QUICK_MATCH_SYSTEM, user, { json: true, maxTokens: 300 });
  if (usage) logDeepSeek('applykit-quick-match', usage, userId);
  const o = parseJsonObject(content);
  const ids = new Set(resumes.map((r) => r.id));
  const score = Math.max(0, Math.min(100, Math.round(Number(o.score) || 0)));
  return {
    resumeId: ids.has(String(o.resumeId)) ? String(o.resumeId) : resumes[0].id,
    score,
    reason: String(o.reason ?? '').trim(),
    missing: String(o.missing ?? '').trim(),
  };
}
