import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logDeepSeek } from '@/lib/logUsage';

// Uses deepseek-chat. Short mode ~$0.001, long mode ~$0.004 per call.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const { text, mode } = (await req.json()) as { text: string; mode?: 'short' | 'long' };
  if (!text?.trim()) return NextResponse.json({ error: 'No content to summarize' }, { status: 400 });

  const isLong = mode === 'long';

  const systemPrompt = isLong
    ? `You are a thorough note summarizer. Produce a detailed summary of the provided content as HTML.
Return ONLY valid HTML using <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em> tags — no markdown, no wrappers.
Structure:
1. A <p> overview of 3–5 sentences covering the main topic and scope.
2. For each major section or theme, use an <h3> heading followed by a <ul> of detailed points.
3. Include specific facts, data, names, or quotes that are important — do not strip detail.
4. If action items or next steps are present, add an <h3>Action Items</h3> with an <ol>.
5. End with a <p> conclusion or takeaway.
Aim for comprehensive coverage — a full page or more is fine for long content.`
    : `You are a concise summarizer. Produce a brief summary of the provided notes as HTML.
Return ONLY valid HTML using <p>, <ul>, <li>, <strong> tags — no markdown, no wrappers.
Structure:
1. A <p> overview of 2–3 sentences.
2. A <ul> of 3–6 key points.
3. If action items are present, a <strong>Action Items</strong> label followed by a <ul>.
Be concise — aim for half a page or less.`;

  const maxTokens = isLong ? 2000 : 512;
  const textLimit = isLong ? 24000 : 8000;

  const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize:\n"""\n${text.trim().slice(0, textLimit)}\n"""` },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });

  if (!aiRes.ok) {
    console.error('DeepSeek summarize error:', await aiRes.text());
    return NextResponse.json({ error: 'Summarize failed' }, { status: 502 });
  }

  const aiJson = await aiRes.json();
  const userId = (session?.user as any)?.id;
  if (aiJson.usage) logDeepSeek('summarize', aiJson.usage, userId);

  const html = (aiJson.choices?.[0]?.message?.content ?? '').trim();
  return NextResponse.json({ html });
}
