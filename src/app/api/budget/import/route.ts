import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logDeepSeek } from '@/lib/logUsage';
import { findOrCreateBudgetDb } from '@/lib/budgetDb';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Category options must match the Personal Budget template.
const CATEGORIES = [
  'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
  'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
  'Subscriptions', 'Investments', 'Debt', 'Gifts & Donations',
  'Emergency Fund', 'Other',
];

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) {
    return buf.toString('utf-8');
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    // pdf-parse's index.js tries to load a test PDF on import — bypass it
    // by importing the implementation file directly.
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as
      (b: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buf);
    return result.text;
  }
  throw new Error('Unsupported file type — upload CSV or PDF');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek not configured' }, { status: 500 });

  let text: string;
  let filename: string;
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    filename = file.name;
    text = await extractText(file);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to read file' }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'No text found in file' }, { status: 400 });
  }

  // DeepSeek does the heavy lifting: parse and categorize in one call.
  const systemPrompt = `You extract financial transactions from bank statements (any format: Chase, BofA, Wells Fargo, Michigan First, credit unions, credit cards, CSVs).

Return ONLY a JSON object with this exact shape — no prose, no markdown fences:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "vendor": "Cleaned merchant name (e.g. 'Amazon Prime', 'Shell', 'McDonald's')",
      "description": "Original short description",
      "amount": -15.89,
      "category": "Food & Dining"
    }
  ]
}

Rules:
- amount is NEGATIVE for expenses/withdrawals, POSITIVE for income/deposits/refunds.
- Skip non-transaction lines: balance forwards, running balances, statement headers, fees summaries, totals, page numbers.
- date must be ISO YYYY-MM-DD. If the statement only shows "Apr 03" without a year, infer the year from the statement header (e.g. "Apr 01, 2026 thru Apr 30, 2026" → 2026).
- vendor: strip transaction codes, merchant numbers, and addresses. Keep just the recognizable name. E.g. "55432866091200231491715 00089047 AMAZON PRIME*JH5BA8CS3 440 Terry Ave N SEATTLE WA" → "Amazon Prime".
- category MUST be exactly one of: ${CATEGORIES.join(', ')}.
- Map intuitively: McDonald's/restaurants/groceries → Food & Dining; gas/Uber/Lyft/parking → Transport; Apple/Netflix/Spotify/Claude.ai/Prime Video/Google One → Subscriptions; clothing/Amazon (non-Prime) → Shopping; salary/direct deposits/refunds → Other (Income type derived from positive amount); Verizon/Comcast/water/electric → Utilities; PayPal/Zelle → Other unless context is clear.
- If you see a bank balance/fee adjustment, skip it.`;

  let aiText: string;
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
  try {
    const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract transactions from this statement:\n\n${text.slice(0, 60_000)}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('DeepSeek import error:', errText);
      return NextResponse.json({ error: 'AI extraction failed' }, { status: 502 });
    }
    const aiJson = await aiRes.json();
    usage = aiJson.usage;
    aiText = aiJson.choices?.[0]?.message?.content ?? '';
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'AI request failed' }, { status: 502 });
  }

  if (usage) await logDeepSeek('budget-import', usage, userId);

  let parsed: { transactions: any[] };
  try {
    parsed = JSON.parse(aiText);
  } catch {
    return NextResponse.json({ error: 'AI returned malformed JSON' }, { status: 502 });
  }

  // Sanitize and validate every transaction
  const cleaned = (parsed.transactions ?? [])
    .map((t: any) => {
      const amount = Number(t.amount);
      if (isNaN(amount) || amount === 0) return null;
      const date = String(t.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      let category = String(t.category ?? 'Other');
      if (!CATEGORIES.includes(category)) category = 'Other';
      return {
        date,
        vendor: String(t.vendor ?? '').slice(0, 100),
        description: String(t.description ?? '').slice(0, 200),
        amount,
        category,
      };
    })
    .filter(Boolean);

  // Find/create the user's budget DB so the client knows where to confirm to
  const budgetDb = await findOrCreateBudgetDb(userId);

  return NextResponse.json({
    databaseId: budgetDb.id,
    databaseName: budgetDb.name,
    filename,
    transactions: cleaned,
    categories: CATEGORIES,
  });
}
