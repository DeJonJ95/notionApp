import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logDeepSeek } from '@/lib/logUsage';

export const runtime = 'nodejs';
export const maxDuration = 30;

const DS_URL = 'https://api.deepseek.com/chat/completions';

const systemPrompt = `You are a knowledgeable librarian. Given a book title and author, produce a concise summary of the book as HTML.

Return ONLY valid HTML using <p>, <strong>, <em>, <ul>, <li> tags — no markdown, no code fences, no wrappers.

Structure:
1. A <p> with a 2–3 sentence overview of what the book is about.
2. If relevant, a <strong>Key Themes:</strong> label followed by a <ul> of 3–5 themes or topics the book explores.
3. A <p> with the book's significance, genre, or notable context (e.g. awards, influence, adaptations).

Keep it tight — about one short paragraph worth of content. Do NOT write a full review, do NOT give star ratings, and do NOT include spoilers beyond what a back-cover blurb would reveal.

If you don't recognize the book, give your best guess based on the title and author, and prefix the summary with a <em>(Best guess — I may not have full details on this title.)</em> note.`;

async function callDeepSeek(
  apiKey: string,
  system: string,
  user: string,
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
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  if (!r.ok) {
    console.error('DeepSeek book-summary error:', await r.text());
    throw new Error('Book summary failed');
  }
  const j = await r.json();
  return { content: (j.choices?.[0]?.message?.content ?? '').trim(), usage: j.usage };
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title, author } = await req.json().catch(() => ({}));
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Book title is required' }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    }

    const userMessage = author
      ? `Book: "${title.trim()}" by ${author.trim()}`
      : `Book: "${title.trim()}"`;

    const { content, usage } = await callDeepSeek(apiKey, systemPrompt, userMessage);

    if (usage) {
      logDeepSeek({ ...usage, userId: (session.user as any).id, feature: 'book-summary' }).catch(() => {});
    }

    // Google search for the book PDF
    const query = encodeURIComponent(`${title.trim()} ${author ? `by ${author.trim()} ` : ''}pdf`);
    const pdfSearchUrl = `https://www.google.com/search?q=${query}`;

    return NextResponse.json({ summary: content, pdfSearchUrl });
  } catch (err: any) {
    console.error('book-summary error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
