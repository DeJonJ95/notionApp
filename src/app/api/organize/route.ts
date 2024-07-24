import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const { text } = await req.json() as { text: string };
  if (!text?.trim()) return NextResponse.json({ error: 'No content to organize' }, { status: 400 });

  const systemPrompt = `You are a note-organizing assistant. Take raw stream-of-consciousness meeting notes and return them as clean, structured HTML for a rich text editor.

Rules:
- Preserve ALL information — do not remove, summarize, or omit anything
- Group related ideas under clear headings
- Format action items as a bulleted list under an "Action Items" section if present
- Fix obvious typos and grammar, but keep the author's voice
- Return ONLY valid HTML using these tags: <h1> <h2> <h3> <p> <ul> <ol> <li> <strong> <em>
- No <html>, <body>, <head>, <script>, <style>, or any other wrapper/metadata tags
- No markdown syntax, no code fences — just clean HTML fragments`;

  const userPrompt = `Organize these notes:\n"""\n${text.trim()}\n"""`;

  const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!aiRes.ok) {
    console.error('DeepSeek error:', await aiRes.text());
    return NextResponse.json({ error: 'AI organize failed' }, { status: 502 });
  }

  const aiJson = await aiRes.json();
  const html = (aiJson.choices?.[0]?.message?.content ?? '').trim();

  return NextResponse.json({ html });
}
