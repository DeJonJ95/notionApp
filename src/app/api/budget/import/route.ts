import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';
import { findOrCreateBudgetDb, getBudgetCategories, matchCategorizationRule } from '@/lib/budgetDb';
import { fallbackCategory } from '@/lib/budgetCategories';
import { looksLikePdf, describePdfFailure } from '@/lib/budgetImportFile';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Error carrying a user-facing message plus the library's own wording. */
class FileReadError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

// pdf.js versions bundled with pdf-parse, newest first after the default.
// Their XRef recovery differs, so a file one build gives up on can still parse
// with another. Cheap to retry: it's the same already-installed dependency.
const PDFJS_VERSIONS = ['v1.10.100', 'v2.0.550', 'v1.10.88'];

/** pdf-parse can reject page-level promises AFTER its own promise resolves.
 *  Node 20 treats those as unhandled and kills the process, which turns a
 *  damaged PDF into a dead serverless invocation instead of an error message.
 *  Absorb them for the duration of the parse (plus a short drain), so a bad
 *  file fails as a 400 rather than a 500. */
async function withRejectionGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const swallowed: unknown[] = [];
  const onRejection = (reason: unknown) => swallowed.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    return await fn();
  } finally {
    // Late rejections land a few ticks after the main promise settles.
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off('unhandledRejection', onRejection);
    if (swallowed.length > 0) {
      console.warn(
        `[budget-import] ${label}: absorbed ${swallowed.length} late pdf-parse rejection(s):`,
        swallowed.map((r) => (r as Error)?.message ?? String(r)).join('; '),
      );
    }
  }
}

async function extractPdfText(buf: Buffer, filename: string): Promise<string> {
  // pdf-parse's index.js tries to load a test PDF on import — bypass it
  // by importing the implementation file directly. No types ship for the
  // subpath, so cast through any.
  const mod = (await import('pdf-parse/lib/pdf-parse.js' as any)) as any;
  const pdfParse = (mod.default ?? mod) as (
    b: Buffer,
    opts?: { version?: string },
  ) => Promise<{ text: string }>;

  let lastMessage = 'Unknown PDF error';
  for (const version of PDFJS_VERSIONS) {
    try {
      const result = await withRejectionGuard(`${filename} (${version})`, () =>
        pdfParse(buf, { version }),
      );
      if (result.text.trim()) return result.text;
      lastMessage = 'No text layer found';
    } catch (e: any) {
      lastMessage = e?.message ?? String(e);
      console.warn(`[budget-import] ${filename}: pdf.js ${version} failed: ${lastMessage}`);
    }
  }

  if (lastMessage === 'No text layer found') {
    throw new FileReadError(
      `"${filename}" has no readable text — it's probably a scanned image. ` +
        `Export the statement as CSV, or use a text-based PDF.`,
      lastMessage,
    );
  }
  const { error, detail } = describePdfFailure(filename, lastMessage);
  throw new FileReadError(error, detail);
}

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (buf.length === 0) throw new FileReadError(`"${file.name}" is empty.`);

  // Sniff the bytes before trusting the name or MIME type. A PDF handed over
  // with a text/* content type would otherwise be UTF-8 decoded into garbage
  // and sent to the AI as if it were a CSV.
  if (looksLikePdf(buf)) return extractPdfText(buf, file.name);

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    throw new FileReadError(
      `"${file.name}" is named like a PDF but doesn't contain PDF data. ` +
        `The download may have failed — try downloading it from your bank again.`,
    );
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) {
    return buf.toString('utf-8');
  }
  throw new FileReadError('Unsupported file type — upload CSV or PDF');
}

type CompactTx = [string, string, string, number, string];
// Indices on the array form below.
const I_DATE = 0;
const I_VENDOR = 1;
const I_DESC = 2;
const I_AMT = 3;
const I_CAT = 4;

// Built per request so the category list comes from the user's own Category
// options rather than a hard-coded copy.
const buildSystemPrompt = (categories: string[]) => `You extract financial transactions from bank statements (any format: Chase, BofA, Wells Fargo, Michigan First, credit unions, credit cards, CSVs).

Return ONLY a JSON object with this exact compact shape — no prose, no markdown fences:
{ "meta": { "account": "Checking 1234", "openingBalance": 1450.22, "closingBalance": 1187.65 },
  "t": [ ["YYYY-MM-DD","Vendor","short desc",-15.89,"Category"], ... ] }

"meta" describes the statement itself, read from its header/summary:
  account — the account label as printed, e.g. "Checking ...1234" or "Freedom Unlimited". null if not shown.
  openingBalance — the beginning/previous balance for the period. null if not shown.
  closingBalance — the ending/new balance for the period. null if not shown.
Meta rules:
- Use null for anything the statement does not state. NEVER derive a balance by adding up transactions — report only printed figures.
- For a CREDIT CARD statement, report balances as NEGATIVE numbers, because the balance is money owed.

Each element of "t", in order:
  0: date — ISO YYYY-MM-DD
  1: vendor — cleaned merchant name (strip codes, merchant numbers, address)
  2: description — original short description (keep it brief — under 60 chars)
  3: amount — NEGATIVE for expenses, POSITIVE for income/deposits/refunds
  4: category — MUST be exactly one of: ${categories.join(', ')}

Rules:
- Keep "t" to real transactions only: no balance forwards, running balances, statement headers, fees summaries, totals, page numbers, or bank-disclosure footer text. Balances belong in "meta", never in "t".
- If the statement only shows "Apr 03" without a year, infer the year from the statement header (e.g. "Apr 01, 2026 thru Apr 30, 2026" → 2026).
- Strip codes from vendors. E.g. "55432866091200231491715 00089047 AMAZON PRIME*JH5BA8CS3 440 Terry Ave N SEATTLE WA" → "Amazon Prime".
- Map intuitively, but only to categories that appear in the list above; if one of these targets isn't listed, pick the closest option that is. McDonald's/restaurants/groceries → Food & Dining; gas/Uber/Lyft/parking → Transport; Apple/Netflix/Spotify/Claude.ai/Prime Video/Google One → Subscriptions; clothing/Amazon (non-Prime) → Shopping; direct deposits/refunds → Other; Verizon/Comcast/water/electric → Utilities; insurance → Insurance; credit card payments and moves between the account holder's OWN accounts (checking→savings, card payoff) → Transfers.
- "Transfers" means money that never left the account holder. Money sent to ANOTHER PERSON — Zelle, Venmo, Cash App, PayPal or a wire addressed to someone's name — is real spending, NOT a transfer. Categorize it by what it is for, and use Gifts & Donations when the statement does not say.
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

async function callDeepSeek(apiKey: string, systemPrompt: string, userText: string) {
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

export type StatementMeta = {
  account: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
};

const EMPTY_META: StatementMeta = { account: null, openingBalance: null, closingBalance: null };

function num(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseMeta(parsed: any): StatementMeta {
  const m = parsed?.meta;
  if (!m || typeof m !== 'object') return EMPTY_META;
  const account = String(m.account ?? '').trim().slice(0, 80);
  return {
    account: account || null,
    openingBalance: num(m.openingBalance),
    closingBalance: num(m.closingBalance),
  };
}

function parseStatement(rawText: string): { meta: StatementMeta; rows: CompactTx[] } {
  const stripped = stripFences(rawText);
  let parsed: any = null;
  try { parsed = JSON.parse(stripped); } catch {}
  if (!parsed) {
    const salvaged = salvageJsonObject(stripped);
    if (salvaged) {
      try { parsed = JSON.parse(salvaged); } catch {}
    }
  }
  if (!parsed) return { meta: EMPTY_META, rows: [] };
  const arr = parsed.t ?? parsed.transactions ?? [];
  if (!Array.isArray(arr)) return { meta: parseMeta(parsed), rows: [] };
  const rows = arr
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
  return { meta: parseMeta(parsed), rows };
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
    return NextResponse.json(
      {
        error: e?.message ?? 'Failed to read file',
        // The library's own wording, kept for bug reports.
        ...(e?.detail ? { detail: e.detail } : {}),
      },
      { status: 400 },
    );
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'No text found in file' }, { status: 400 });
  }

  // Resolve the budget DB first — its Category options define the list the AI
  // is allowed to use, so any option the user added is honoured.
  const budgetDb = await findOrCreateBudgetDb(userId);
  const categories = getBudgetCategories(budgetDb);
  const systemPrompt = buildSystemPrompt(categories);
  const otherCategory = fallbackCategory(categories);

  // Chunk if needed so we don't exceed DeepSeek's 8K output cap on long
  // statements. ~20K input chars yields ~30–40 transactions, well within
  // the 8K-token output budget when using the compact array format.
  const chunks = chunkText(text.slice(0, 100_000), 20_000);
  console.log(`[budget-import] ${chunks.length} chunk(s), total ${text.length} chars`);

  const allRows: CompactTx[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let anyTruncated = false;
  // Statement headers live at the top of the file, so only the first chunk can
  // speak to the account and its balances.
  let meta: StatementMeta = EMPTY_META;

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (i > 0) {
      chunk = `(continuation of bank statement — same date format applies; the header is not in this part, so set every "meta" field to null)\n\n${chunk}`;
    }
    try {
      const r = await callDeepSeek(apiKey, systemPrompt, chunk);
      if (r.usage) {
        totalIn += r.usage.prompt_tokens;
        totalOut += r.usage.completion_tokens;
      }
      if (r.finishReason === 'length') anyTruncated = true;
      const parsed = parseStatement(r.text);
      if (i === 0) meta = parsed.meta;
      console.log(`[budget-import] chunk ${i + 1}/${chunks.length}: ${parsed.rows.length} rows (finish=${r.finishReason})`);
      allRows.push(...parsed.rows);
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
      let category = String(r[I_CAT] ?? otherCategory);
      if (!categories.includes(category)) category = otherCategory;
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

  // Apply the user's saved categorization rules — these OVERRIDE DeepSeek
  // when a rule's match string is contained in the vendor (case-insensitive).
  // This is how corrections "stick" across imports.
  try {
    const rules = await prisma.categorizationRule.findMany({ where: { userId } });
    if (rules.length > 0) {
      for (const tx of cleaned as any[]) {
        const hit = matchCategorizationRule(tx.vendor ?? '', Number(tx.amount) || 0, rules);
        if (hit) tx.category = hit.category;
      }
    }
  } catch (e) {
    // Table not migrated yet — skip rules, don't fail the import
    console.warn('[budget-import] categorization rules skipped:', (e as Error).message);
  }

  return NextResponse.json({
    databaseId: budgetDb.id,
    databaseName: budgetDb.name,
    filename,
    transactions: cleaned,
    meta,
    categories,
    truncated: anyTruncated, // hint for the UI in case results look short
  });
}
