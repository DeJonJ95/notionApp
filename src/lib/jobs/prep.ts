// Interview prep: a pack of likely questions with talking points drawn from
// the candidate's resume, plus feedback on practice answers. Same contract as
// the rest of ApplyKit: every talking point must trace to something the
// resume already says, and gaps are answered honestly, never papered over.

import { plainDashes } from '@/lib/prose';

export type PrepKind = 'behavioral' | 'technical' | 'role' | 'motivation';

export type PrepQuestion = { q: string; kind: PrepKind; why: string; points: string[]; evidence: string };

export type InterviewPrep = {
  pitch: string;
  questions: PrepQuestion[];
  gaps: { gap: string; answer: string }[];
  ask: string[];
  resumeId: string;
  resumeLabel: string;
  createdAt: string;
};

export type PracticeFeedback = { rating: 'strong' | 'solid' | 'needs work'; strengths: string[]; improve: string[]; tighter: string };

const RULES = `HARD RULES:
- Use only experience, employers, titles, dates, skills and figures that appear in the candidate's resume. Never invent any of them.
- Do not tie a skill to a job or project unless the resume ties them together. A skill listed only in a skills section has no known project.
- When the job asks for something the resume does not show, say so plainly and answer with adjacent real experience plus a concrete plan to close the gap.
- Plain, direct prose in first person where the candidate is speaking. No em dashes (the "—" character). No "not X, but Y" phrasing. No placeholders or brackets.`;

export const PREP_SYSTEM = `You are an interview coach preparing a candidate for one specific job.
${RULES}
Return ONLY a JSON object.`;

// Two halves generated in parallel, so neither call runs long enough to time out.
// Each half owns its question kinds; parsePrep drops strays so the halves never overlap.
export const PREP_PARTS = [
  `Return {"pitch": string, "questions": Question[]}.
"pitch": a 60-second answer to "Tell me about yourself" aimed at this role, 90-130 words.
"questions": the 6 behavioral and motivation questions this interviewer is most likely to ask, given what the job emphasizes. Every question's kind is "behavioral" or "motivation"; technical questions are covered elsewhere.`,
  `Return {"questions": Question[], "gaps": [{"gap": string, "answer": string}], "ask": string[]}.
"questions": the 6 technical and role-specific questions most likely for this job's stated requirements and stack. Every question's kind is "technical" or "role"; behavioral questions are covered elsewhere.
"gaps": for the 5 listed gaps an interviewer is most likely to probe (fewer if fewer are listed), a 2-3 sentence honest answer.
"ask": 4 sharp questions the candidate should ask the interviewer, specific to this posting.`,
];

const QUESTION_SHAPE = `Question = {"q": string, "kind": "behavioral" | "technical" | "role" | "motivation", "why": string (what the interviewer is really probing, tied to the posting), "points": string[] (2-4 short talking points), "evidence": string (the resume experience to tell this story with, named specifically)}`;

export function buildPrepUser(
  part: string,
  job: { title: string; company: string; description: string },
  resumeText: string,
  extra: { requirements: string[]; gaps: string[] },
): string {
  return `${part}
${QUESTION_SHAPE}

ROLE: ${job.title} at ${job.company}
KEY REQUIREMENTS: ${extra.requirements.join('; ') || 'see posting'}
GAPS (requirements the resume does not show): ${extra.gaps.join('; ') || 'none listed'}

JOB POSTING:
"""
${job.description.slice(0, 7000)}
"""

CANDIDATE RESUME:
"""
${resumeText.slice(0, 7000)}
"""`;
}

function parseObject(content: string): Record<string, unknown> {
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  const parsed: unknown = JSON.parse(s >= 0 && e > s ? content.slice(s, e + 1) : content);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => plainDashes(typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown): string[] => list(v).map(text).filter(Boolean);
const KINDS: PrepKind[] = ['behavioral', 'technical', 'role', 'motivation'];

function question(v: unknown): PrepQuestion | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const q = text(o.q);
  if (!q) return null;
  const kind = KINDS.find((k) => k === o.kind) ?? 'role';
  return { q, kind, why: text(o.why), points: texts(o.points), evidence: text(o.evidence) };
}

const PART_KINDS: PrepKind[][] = [['behavioral', 'motivation'], ['technical', 'role']];

function partQuestions(o: Record<string, unknown>, i: number): PrepQuestion[] {
  return list(o.questions)
    .map(question)
    .filter((q): q is PrepQuestion => !!q && (PART_KINDS[i] ?? KINDS).includes(q.kind));
}

function tryObject(content: string): Record<string, unknown> {
  try { return parseObject(content); } catch { return {}; }
}

/** Merge the two halves into one pack. A half that comes back cut off or malformed is dropped, not fatal. */
export function parsePrep(parts: string[]): Omit<InterviewPrep, 'resumeId' | 'resumeLabel' | 'createdAt'> {
  const objs = parts.map(tryObject);
  return {
    pitch: text(objs[0]?.pitch),
    questions: objs.flatMap(partQuestions),
    gaps: objs.flatMap((o) => list(o.gaps)).map((g) => {
      const o = g && typeof g === 'object' ? (g as Record<string, unknown>) : {};
      return { gap: text(o.gap), answer: text(o.answer) };
    }).filter((g) => g.gap && g.answer),
    ask: objs.flatMap((o) => texts(o.ask)),
  };
}

export const PRACTICE_SYSTEM = `You are an interview coach giving feedback on a practice answer for one specific job.
${RULES}
Judge the answer against what the question probes and what the posting needs. Credit specifics; flag vagueness, missing results, rambling, and claims the resume does not support.
Return ONLY a JSON object: {"rating": "strong" | "solid" | "needs work", "strengths": string[] (1-3), "improve": string[] (1-3, concrete), "tighter": string (the candidate's own answer reorganized and tightened, 80-150 words)}.
"tighter" keeps the candidate's facts and adds none: no new process steps, durations, numbers, tools or outcomes, even plausible ones. Missing detail belongs in "improve", where the candidate can supply the real version.`;

export function buildPracticeUser(
  job: { title: string; company: string },
  q: { q: string; why: string },
  answer: string,
  resumeText: string,
): string {
  return `ROLE: ${job.title} at ${job.company}
QUESTION: ${q.q}
WHAT IT PROBES: ${q.why || 'n/a'}

CANDIDATE'S ANSWER:
"""
${answer.slice(0, 4000)}
"""

CANDIDATE RESUME:
"""
${resumeText.slice(0, 6000)}
"""`;
}

export function parsePractice(content: string): PracticeFeedback {
  const o = parseObject(content);
  const ratings: PracticeFeedback['rating'][] = ['strong', 'solid', 'needs work'];
  return {
    rating: ratings.find((r) => r === o.rating) ?? 'solid',
    strengths: texts(o.strengths),
    improve: texts(o.improve),
    tighter: text(o.tighter),
  };
}
