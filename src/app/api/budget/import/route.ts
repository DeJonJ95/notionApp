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
    // by importing the implementation file directly. No types ship for the
    // subpath, so cast through any.
    const mod = (await import('pdf-parse/lib/pdf-parse.js' as any)) as any;
    const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buf);
    return result.text;
  }
  throw new Error('Unsupported file type — upload CSV or PDF');
}

type CompactTx = [string, string, string, number, string];
// Indices on the array form below.
const I_DATE = 0;
const I_VENDOR = 1;
const I_DESC = 2;
const I_AMT = 3;
const I_CAT = 4;

const systemPrompt = `You extract financial transactions from bank statements (any format: Chase, BofA, Wells Fargo, Michigan First, credit unions, credit cards, CSVs).

Return ONLY a JSON object with this exact compact shape — no prose, no markdown fences:
{ "t": [ ["YYYY-MM-DD","Vendor","short desc",-15.89,"Category"], ... ] }

Each array element fields, in order:
  0: date — ISO YYYY-MM-DD
  1: vendor — cleaned merchant name (strip codes, merchant numbers, address)
  2: description — original short description (keep it brief — under 60 chars)
  3: amount — NEGATIVE for expenses, POSITIVE for income/deposits/refunds
  4: category — MUST be exactly one of: ${CATEGORIES.join(', ')}

Rules:
- Skip non-transaction lines: balance forwards, running balances, statement headers, fees summaries, totals, page numbers, bank-disclosure footer text.
- If the statement only shows "Apr 03" without a year, infer the year from the statement header (e.g. "Apr 01, 2026 thru Apr 30, 2026" → 2026).
- Strip codes from vendors. E.g. "55432866091200231491715 00089047 AMAZON PRIME*JH5BA8CS3 440 Terry Ave N SEATTLE WA" → "Amazon Prime".
- Map intuitively: McDonald's/restaurants/groceries → Food & Dining; gas/Uber/Lyft/parking → Transport; Apple/Netflix/Spotify/Claude.ai/Prime Video/Google One → Subscriptions; clothing/Amazon (non-Prime) → Shopping; direct deposits/refunds → Other; Verizon/Comcast/water/electric → Utilities; insurance → Insurance; PayPal/Zelle/Apple Cash transfers → Other.
- Output ONLY the JSON object. No \`\`\` fences, no prose.`;

// Strip markdown fences if DeepSeek wraps the JSON despite response_format.
function stripFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

// Pull a JSON object out of a possibly-truncated string by counting braces
// and stopping at the last balanced one. Helps recover from output that got
// cut off mid-array — we keep whatever entries completed before the cut.
function salvageJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastBalanced = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) lastBalanced = i;
    }
  }
  if (lastBalanced > 0) return s.slice(start, lastBalanced + 1);
  // Output was truncated mid-object. Try to close it by snipping the final
  // incomplete array element and appending the right number of closers.
  // Find the last complete top-level array element (trailing ",").
  const lastComma = s.lastIndexOf(',');
  if (lastComma === -1) return null;
  const truncated = s.slice(start, lastComma);
  // Close any open arrays/objects we entered after that comma.
  let openArr = 0, openObj = 0;
  inString = false; escape = false;
  for (let i = 0; i < truncated.length; i++) {
    const c = truncated[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '[') openArr++;
    else if (c === ']') openArr--;
    else if (c === '{') openObj++;
    else if (c === '}') openObj--;
  }
  return truncated + ']'.repeat(Math.max(0, openArr)) + '}'.repeat(Math.max(0, openObj));
}

// Chunk text into pieces small enough that DeepSeek's 8K output cap
// comfortably fits the parsed result. Splits on blank lines so we don't
// cut a transaction in half.
function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n\n' + p).length > maxChars && cur.length > 0) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function callDeepSeek(apiKey: string, userText: string) {
  const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract transactions from this statement:\n\n${userText}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8000,
    }),
  });
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error('DeepSeek import error:', errText);
    throw new Error('AI extraction failed');
  }
  const aiJson = await aiRes.json();
  return {
    text: aiJson.choices?.[0]?.message?.content ?? '',
    usage: aiJson.usage as { prompt_tokens: number; completion_tokens: number } | undefined,
    finishReason: aiJson.choices?.[0]?.finish_reason as string | undefined,
  };
}

function parseTransactions(rawText: string): CompactTx[] {
  const stripped = stripFences(rawText);
  let parsed: any = null;
  try { parsed = JSON.parse(stripped); } catch {}
  if (!parsed) {
    const salvaged = salvageJsonObject(stripped);
    if (salvaged) {
      try { parsed = JSON.parse(salvaged); } catch {}
    }
  }
  if (!parsed) return [];
  const arr = parsed.t ?? parsed.transactions ?? [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((row: any): CompactTx | null => {
      // Accept either compact array or legacy object shape
      if (Array.isArray(row) && row.length >= 5) {
        return row as CompactTx;
      }
      if (row && typeof row === 'object') {
        return [row.date, row.vendor, row.description ?? '', Number(row.amount), row.category];
      }
      return null;
    })
    .filter((r): r is CompactTx => r !== null);
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

  // Chunk if needed so we don't exceed DeepSeek's 8K output cap on long
  // statements. ~20K input chars yields ~30–40 transactions, well within
  // the 8K-token output budget when using the compact array format.
  const chunks = chunkText(text.slice(0, 100_000), 20_000);
  console.log(`[budget-import] ${chunks.length} chunk(s), total ${text.length} chars`);

  const allRows: CompactTx[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let anyTruncated = false;

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (i > 0) chunk = `(continuation of bank statement — same date format applies)\n\n${chunk}`;
    try {
      const r = await callDeepSeek(apiKey, chunk);
      if (r.usage) {
        totalIn += r.usage.prompt_tokens;
        totalOut += r.usage.completion_tokens;
      }
      if (r.finishReason === 'length') anyTruncated = true;
      const rows = parseTransactions(r.text);
      console.log(`[budget-import] chunk ${i + 1}/${chunks.length}: ${rows.length} rows (finish=${r.finishReason})`);
      allRows.push(...rows);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'AI request failed' }, { status: 502 });
    }
  }

  if (totalIn > 0) await logDeepSeek('budget-import', { prompt_tokens: totalIn, completion_tokens: totalOut }, userId);

  // Dedupe (chunk overlap can produce duplicates): identical date+amount+vendor
  const seen = new Set<string>();
  const uniqueRows = allRows.filter((r) => {
    const key = `${r[I_DATE]}|${r[I_AMT]}|${(r[I_VENDOR] ?? '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sanitize and validate every transaction
  const cleaned = uniqueRows
    .map((r) => {
      const amount = Number(r[I_AMT]);
      if (isNaN(amount) || amount === 0) return null;
      const date = String(r[I_DATE] ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      let category = String(r[I_CAT] ?? 'Other');
      if (!CATEGORIES.includes(category)) category = 'Other';
      return {
        date,
        vendor: String(r[I_VENDOR] ?? '').slice(0, 100),
        description: String(r[I_DESC] ?? '').slice(0, 200),
        amount,
        category,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.date < b!.date ? -1 : a!.date > b!.date ? 1 : 0));

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: 'AI did not return any transactions. The file may not be a bank statement, or formatting may be unusual.' },
      { status: 422 }
    );
  }

  // Find/create the user's budget DB so the client knows where to confirm to
  const budgetDb = await findOrCreateBudgetDb(userId);

  return NextResponse.json({
    databaseId: budgetDb.id,
    databaseName: budgetDb.name,
    filename,
    transactions: cleaned,
    categories: CATEGORIES,
    truncated: anyTruncated, // hint for the UI in case results look short
  });
}
