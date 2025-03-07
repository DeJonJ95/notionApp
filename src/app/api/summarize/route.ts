import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logDeepSeek } from '@/lib/logUsage';

// deepseek-chat: 64K input context, ~8K output cap. Short notes go in one
// call; long content (hour-long transcripts) is map-reduced — chunk it,
// note each chunk, then synthesize one summary from the notes — so nothing
// is silently truncated.

export const runtime = 'nodejs';
export const maxDuration = 60;

const DS_URL = 'https://api.deepseek.com/chat/completions';

// Single call below this; map-reduce above it. ~14k chars ≈ 3.5k tokens —
// comfortable for one pass with room for the output.
const SINGLE_CALL_LIMIT = 14_000;
const CHUNK_CHARS = 12_000;
const MAX_TOTAL_CHARS = 240_000; // ~64k-token ceiling guard

const shortPrompt = `You are a concise summarizer. Produce a brief summary of the provided notes as HTML.
Return ONLY valid HTML using <p>, <ul>, <li>, <strong> tags — no markdown, no wrappers.
Structure:
1. A <p> overview of 2–3 sentences.
2. A <ul> of 3–6 key points.
3. If action items are present, a <strong>Action Items</strong> label followed by a <ul>.
Be concise — aim for half a page or less.`;

const longPrompt = `You are a thorough note summarizer. Produce a detailed summary of the provided content as HTML.
Return ONLY valid HTML using <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em> tags — no markdown, no wrappers.
Structure:
1. A <p> overview of 3–5 sentences covering the main topic and scope.
2. For each major section or theme, use an <h3> heading followed by a <ul> of detailed points.
3. Include specific facts, data, names, or quotes that are important — do not strip detail.
4. If action items or next steps are present, add an <h3>Action Items</h3> with an <ol>.
5. End with a <p> conclusion or takeaway.
Aim for comprehensive coverage — a full page or more is fine for long content.`;

// Plain-text intermediate notes for the map step (cheap output, easy to
// concatenate for the reduce step).
const mapPrompt = `You are extracting notes from one segment of a longer document/transcript.
List the key points, facts, names, numbers, decisions, and any action items as concise plain-text bullet lines (start each with "- "). No preamble, no conclusion, no markdown headers — just the bullets. Capture detail; do not editorialize.`;

async function callDeepSeek(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  const r = await fetch(DS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });
  if (!r.ok) {
    console.error('DeepSeek summarize error:', await r.text());
    throw new Error('Summarize failed');
  }
  const j = await r.json();
  return { content: (j.choices?.[0]?.message?.content ?? '').trim(), usage: j.usage };
}

// Split on paragraph/sentence boundaries so a chunk never cuts mid-thought.
function chunk(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts = text.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + '\n\n' + p).length > max) { out.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) out.push(cur);
  // A single mega-paragraph (some transcripts have no blank lines) — hard-split.
  return out.flatMap((c) =>
    c.length <= max
      ? [c]
      : Array.from({ length: Math.ceil(c.length / max) }, (_, i) => c.slice(i * max, (i + 1) * max))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const { text, mode } = (await req.json()) as { text: string; mode?: 'short' | 'long' };
  if (!text?.trim()) return NextResponse.json({ error: 'No content to summarize' }, { status: 400 });

  const isLong = mode === 'long';
  const finalSystem = isLong ? longPrompt : shortPrompt;
  const finalMax = isLong ? 2000 : 512;
  const source = text.trim().slice(0, MAX_TOTAL_CHARS);

  let totalIn = 0;
  let totalOut = 0;
  const track = (u?: { prompt_tokens: number; completion_tokens: number }) => {
    if (u) { totalIn += u.prompt_tokens; totalOut += u.completion_tokens; }
  };

  try {
    let html: string;

    if (source.length <= SINGLE_CALL_LIMIT) {
      // Fast path — fits in one call (covers virtually all typed notes).
      const r = await callDeepSeek(apiKey, finalSystem, `Summarize:\n"""\n${source}\n"""`, finalMax);
      track(r.usage);
      html = r.content;
    } else {
      // Map: summarize each chunk into compact bullet notes.
      const chunks = chunk(source, CHUNK_CHARS);
      const notes: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const r = await callDeepSeek(
          apiKey,
          mapPrompt,
          `Segment ${i + 1} of ${chunks.length}:\n"""\n${chunks[i]}\n"""`,
          900,
        );
        track(r.usage);
        notes.push(r.content);
      }
      // Reduce: synthesize the per-chunk notes into the final summary.
      const r = await callDeepSeek(
        apiKey,
        finalSystem,
        `Below are ordered notes extracted from a long document/transcript in sequence. ` +
          `Synthesize them into one cohesive summary as instructed — do not just concatenate.\n\n` +
          notes.map((n, i) => `--- Segment ${i + 1} ---\n${n}`).join('\n\n'),
        finalMax,
      );
      track(r.usage);
      html = r.content;
    }

    if (totalIn > 0) logDeepSeek('summarize', { prompt_tokens: totalIn, completion_tokens: totalOut }, userId);
    return NextResponse.json({ html });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Summarize failed' }, { status: 502 });
  }
}
