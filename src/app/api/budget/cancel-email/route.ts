import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logDeepSeek } from '@/lib/logUsage';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  const userName = session?.user?.name ?? '';
  const userEmail = session?.user?.email ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek not configured' }, { status: 500 });

  const { vendor, monthlyAmount, lastChargeDate } = (await req.json()) as {
    vendor: string;
    monthlyAmount?: number;
    lastChargeDate?: string;
  };
  if (!vendor) return NextResponse.json({ error: 'vendor required' }, { status: 400 });

  const systemPrompt = `You draft polite, firm subscription-cancellation emails.
Return ONLY a JSON object — no markdown, no prose around it:
{
  "to": "best-guess support email for the company (e.g. support@netflix.com). If unknown, use 'support@<lowercase-vendor>.com'.",
  "subject": "Short subject line",
  "body": "Plain-text email body. 80-150 words. Polite but unambiguous: requesting cancellation effective immediately, no further charges, confirmation by reply. Include account email and last charge details if provided. Sign with the user's name."
}`;

  const userContext = `Cancel my subscription to: ${vendor}
${monthlyAmount ? `Monthly charge: $${monthlyAmount.toFixed(2)}` : ''}
${lastChargeDate ? `Last charged: ${lastChargeDate}` : ''}
My name: ${userName || '(use a generic sign-off)'}
My email on the account: ${userEmail || '(unknown)'}`;

  const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContext },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  if (!aiRes.ok) {
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }
  const aiJson = await aiRes.json();
  if (aiJson.usage) await logDeepSeek('cancel-email', aiJson.usage, userId);
  const content = aiJson.choices?.[0]?.message?.content ?? '{}';

  try {
    const parsed = JSON.parse(content);
    return NextResponse.json({
      to: String(parsed.to ?? ''),
      subject: String(parsed.subject ?? `Cancel my ${vendor} subscription`),
      body: String(parsed.body ?? ''),
    });
  } catch {
    return NextResponse.json({ error: 'Malformed AI response' }, { status: 502 });
  }
}
