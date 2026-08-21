// DeepSeek wiring for ApplyKit. Mirrors the fetch shape used in
// src/app/api/summarize/route.ts (deepseek-chat, low temperature, usage
// returned for logUsage). Kept separate so the analyze route stays thin.

const DS_URL = 'https://api.deepseek.com/chat/completions';

export type DSUsage = { prompt_tokens: number; completion_tokens: number };

const DS_TIMEOUT_MS = 25_000;

export async function callDeepSeek(
  apiKey: string,
  system: string,
  user: string,
  opts?: { maxTokens?: number; json?: boolean; temperature?: number },
): Promise<{ content: string; usage?: DSUsage }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DS_TIMEOUT_MS);
  try {
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
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('DeepSeek ApplyKit error:', await r.text());
      throw new Error('DeepSeek request failed');
    }
    const j = await r.json();
    return { content: (j.choices?.[0]?.message?.content ?? '').trim(), usage: j.usage };
  } finally {
    clearTimeout(timer);
  }
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
- Write each "rewrite" in plain, direct prose: do NOT use em dashes (the "—"
  character; use commas, colons, or separate clauses instead), and do NOT use
  "not X, but Y" antithesis phrasing. State the point directly.

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

// Fallback for capturing a job from a page that has no JobPosting JSON-LD:
// extract just the title + company from the page text. The job description
// itself is taken verbatim from the cleaned page text (not the model) so the
// full JD is preserved and nothing is fabricated.
export const PARSE_PAGE_SYSTEM = `You read the text of a job-posting web page and extract two facts: the job title and the hiring company name.
Return ONLY a JSON object: {"title": string, "company": string}.
Use exactly what the page says. If a field is genuinely not present, use an empty string. Never guess or invent.`;

export function buildParsePageUser(text: string): string {
  return `JOB PAGE TEXT:
"""
${text.slice(0, 9000)}
"""

Return the JSON object now.`;
}

export function parseTitleCompany(content: string): { title: string; company: string } {
  let txt = content.trim();
  if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
  try {
    const o = JSON.parse(txt);
    return { title: String(o.title ?? '').trim(), company: String(o.company ?? '').trim() };
  } catch {
    return { title: '', company: '' };
  }
}

// Short LinkedIn-recruiter outreach message generated alongside the tailored
// resume. Same truthfulness contract: it may only lean on experience the
// resume actually shows.
export const RECRUITER_MSG_SYSTEM = `You help a job candidate write a short outreach message to a LinkedIn recruiter for a specific role.

Rules:
- 2-3 sentences, under 65 words, plain text, first person.
- Warm and genuine, not salesy or buzzword-heavy.
- Plain, direct phrasing. Do NOT use em dashes (the "—" character; use commas, colons, or separate sentences instead), and do NOT use "not X, but Y" antithesis constructions.
- Name the specific role and company, and cite ONE concrete, real strength from the candidate's resume that fits this job. Never invent experience, employers, titles, dates, or metrics not in the resume.
- End with a soft call to action (interest in connecting or learning more).
- No subject line, no greeting placeholders or brackets, no signature, no hashtags. Return ONLY the message text.`;

export function buildRecruiterMsgUser(
  job: { title: string; company: string; description: string },
  resumeText: string,
): string {
  return `ROLE: ${job.title} at ${job.company}

JOB POSTING (excerpt):
"""
${job.description.slice(0, 3000)}
"""

CANDIDATE RESUME:
"""
${resumeText.slice(0, 5000)}
"""

Write the outreach message now.`;
}

// Cover letter generation — same truthfulness contract.
export const COVER_LETTER_SYSTEM = `You are an expert cover-letter writer for technical job candidates.

HARD RULES:
- Write a professional, warm cover letter (3-4 paragraphs, 200-350 words).
- Use only experience, skills, and facts that already appear in the candidate's resume.
- Mirror the job's terminology where the candidate genuinely has that experience.
- NEVER invent employers, titles, dates, metrics, certifications, or skills.
- Address the specific company and role by name.
- Open with a genuine hook (a specific project, value alignment, or product detail).
- Body: match 2-3 resume achievements to job requirements using the job's vocabulary.
- Close with a soft, confident call to action.
- No em dashes. No "not X, but Y" phrasing. Direct, plain prose.
- No placeholders, no bracketed instructions, no "[your name]".
Return ONLY the cover letter text, with no extra commentary.`;

export function buildCoverLetterUser(
  job: { title: string; company: string; description: string },
  resumeText: string,
): string {
  return `ROLE: ${job.title} at ${job.company}

JOB POSTING:
"""
${job.description.slice(0, 4000)}
"""

MY RESUME:
"""
${resumeText.slice(0, 6000)}
"""

Write the cover letter now.`;
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
