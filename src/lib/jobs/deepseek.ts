// DeepSeek wiring for ApplyKit. Mirrors the fetch shape used in
// src/app/api/summarize/route.ts (deepseek-chat, low temperature, usage
// returned for logUsage). Kept separate so the analyze route stays thin.

const DS_URL = 'https://api.deepseek.com/chat/completions';

export type DSUsage = { prompt_tokens: number; completion_tokens: number };

export async function callDeepSeek(
  apiKey: string,
  system: string,
  user: string,
  opts?: { maxTokens?: number; json?: boolean; temperature?: number },
): Promise<{ content: string; usage?: DSUsage }> {
  const r = await fetch(DS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 2000,
      ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) {
    console.error('DeepSeek ApplyKit error:', await r.text());
    throw new Error('DeepSeek request failed');
  }
  const j = await r.json();
  return { content: (j.choices?.[0]?.message?.content ?? '').trim(), usage: j.usage };
}

// The anti-fabrication contract. This is the core safety property of the
// whole tool: the model may only re-surface and re-word experience the
// candidate already has. It must never invent employers, titles, dates,
// metrics, or skills, and it must flag (not paper over) missing requirements.
export const ANALYZE_SYSTEM = `You are an expert technical recruiter and ATS-optimization assistant.
You compare a job description against a candidate's existing resumes and
recommend how to tailor ONE of them — truthfully.

HARD RULES (never break these):
- Only rephrase, reorder, or re-emphasize experience that ALREADY EXISTS in
  the chosen resume's text. Mirror the job's terminology only where the
  candidate genuinely has that experience.
- NEVER invent or imply employers, job titles, dates, seniority, metrics,
  certifications, or skills the resume does not already show.
- If the job requires something no resume demonstrates, list it under "gaps".
  Do NOT fabricate coverage for a gap.
- Every suggested tweak must quote the resume's ORIGINAL line verbatim in
  "original" and give a truthful reworded "rewrite" plus a short "reason".

Return ONLY a JSON object with this exact shape:
{
  "keywords": string[],            // ATS keywords/skills pulled from the JD
  "requirements": string[],        // concrete hard requirements from the JD
  "scores": [                       // one entry PER resume provided
    { "resumeId": string, "label": string, "score": number, "rationale": string }
  ],
  "recommendedResumeId": string,   // the best-fit resume's id
  "suggestedTweaks": [              // tweaks for the RECOMMENDED resume only
    { "resumeId": string, "original": string, "rewrite": string, "reason": string }
  ],
  "gaps": string[],                // requirements no resume credibly covers
  "atsNotes": string               // 1-3 sentences on ATS-friendliness
}
score is 0-100. Keep suggestedTweaks to the 3-8 highest-impact, truthful changes.`;

export type AnalysisResult = {
  keywords: string[];
  requirements: string[];
  scores: { resumeId: string; label: string; score: number; rationale: string }[];
  recommendedResumeId: string;
  suggestedTweaks: { resumeId: string; original: string; rewrite: string; reason: string }[];
  gaps: string[];
  atsNotes: string;
};

export function buildAnalyzeUser(
  job: { title: string; company: string; description: string },
  resumes: { id: string; label: string; parsedText: string }[],
): string {
  const resumeBlocks = resumes
    .map(
      (r) =>
        `RESUME id=${r.id} label="${r.label}":\n"""\n${r.parsedText.slice(0, 8000)}\n"""`,
    )
    .join('\n\n');
  return `JOB POSTING — ${job.title} @ ${job.company}:
"""
${job.description.slice(0, 12000)}
"""

CANDIDATE RESUMES (${resumes.length}):
${resumeBlocks}

Analyze and return the JSON object as specified.`;
}

// DeepSeek is asked for json_object, but be defensive: strip code fences and
// grab the outermost object if the model wraps it.
export function parseAnalysis(content: string): AnalysisResult {
  let txt = content.trim();
  if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
  const obj = JSON.parse(txt);
  return {
    keywords: Array.isArray(obj.keywords) ? obj.keywords.map(String) : [],
    requirements: Array.isArray(obj.requirements) ? obj.requirements.map(String) : [],
    scores: Array.isArray(obj.scores) ? obj.scores : [],
    recommendedResumeId: String(obj.recommendedResumeId ?? ''),
    suggestedTweaks: Array.isArray(obj.suggestedTweaks) ? obj.suggestedTweaks : [],
    gaps: Array.isArray(obj.gaps) ? obj.gaps.map(String) : [],
    atsNotes: String(obj.atsNotes ?? ''),
  };
}
