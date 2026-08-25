import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';
import { callDeepSeek } from '@/lib/jobs/deepseek';
import {
  findOrCreateBudgetDb,
  getBudgetCategories,
  writeTransactions,
  findDuplicateTransactions,
  matchCategorizationRule,
  type ParsedTransaction,
} from '@/lib/budgetDb';
import { fallbackCategory } from '@/lib/budgetCategories';
import {
  isoDay,
  isIsoDate,
  buildCaptureSystemPrompt,
  parseCaptureResponse,
  parseStructuredCapture,
  type CapturedTx,
} from '@/lib/budgetCapture';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Near-real-time transaction capture. Same auth shape as POST /api/capture:
// a clipper bearer token OR a session cookie, plus CORS, so it works from an
// iOS Shortcut reacting to a bank alert, from the extension, or from curl.
//
// Body is either structured:
//   { "amount": 14.52, "vendor": "Starbucks", "date"?, "category"?, "type"?, "account"?, "note"? }
// or the raw notification text, which costs one small DeepSeek call:
//   { "text": "Your card was charged $14.52 at STARBUCKS 8/23" }

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });
  const userId = ctx.userId;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonWithCors(req, { error: 'Invalid JSON body' }, { status: 400 });
  }

  const db = await findOrCreateBudgetDb(userId);
  const categories = getBudgetCategories(db);
  const defaultCategory = fallbackCategory(categories);

  const today = isoDay(new Date());
  let tx: CapturedTx;
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    // ── Structured path: no AI, no spend ──────────────────────────────────
    const result = parseStructuredCapture(body, today);
    if ('error' in result) return jsonWithCors(req, { error: result.error }, { status: 400 });
    tx = result.tx;
  } else if (text) {
    // ── Free-text path: one small DeepSeek call ───────────────────────────
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return jsonWithCors(req, { error: 'DeepSeek not configured' }, { status: 500 });

    const budget = await checkDailyBudget(userId);
    if (!budget.ok) {
      return jsonWithCors(req, budgetExceededResponse(budget.spentUsd, budget.capUsd), { status: 429 });
    }

    let content: string;
    try {
      const r = await callDeepSeek(
        apiKey,
        buildCaptureSystemPrompt(categories, today),
        text.slice(0, 1_000),
        { json: true, maxTokens: 300, temperature: 0.1 },
      );
      content = r.content;
      if (r.usage) await logDeepSeek('budget-capture-tx', r.usage, userId);
    } catch (e: any) {
      return jsonWithCors(req, { error: e?.message ?? 'AI request failed' }, { status: 502 });
    }

    const parsed = parseCaptureResponse(content, today);
    if (!parsed) {
      return jsonWithCors(
        req,
        { error: "Couldn't read a transaction out of that message." },
        { status: 422 },
      );
    }
    tx = parsed;
  } else {
    return jsonWithCors(
      req,
      { error: 'Provide either { amount, vendor } or { text }' },
      { status: 400 },
    );
  }

  if (!categories.includes(tx.category)) tx.category = defaultCategory;

  // ── Categorization rules override whatever we landed on ─────────────────
  // Same precedence as statement import: a user's correction always wins.
  try {
    const rules = await prisma.categorizationRule.findMany({ where: { userId } });

    const hit = matchCategorizationRule(tx.vendor, tx.amount, rules);
    if (hit) tx.category = hit.category;
  } catch (e) {
    console.warn('[budget-capture-tx] categorization rules skipped:', (e as Error).message);
  }

  const account = String(body.account ?? '').trim().slice(0, 80);
  const parsedTx: ParsedTransaction = {
    date: tx.date,
    vendor: tx.vendor,
    description: tx.description,
    amount: tx.amount,
    category: tx.category,
    ...(account ? { account } : {}),
  };

  // ── Dedup before writing ────────────────────────────────────────────────
  // A later statement import is deduped against these rows by the confirm
  // route, so the two paths can't double-count each other.
  try {
    const existing = await loadNearbyTransactions(db.id, tx.date, 4);
    if (findDuplicateTransactions(existing, [parsedTx]).length > 0) {
      return jsonWithCors(req, { ok: true, duplicate: true, transaction: parsedTx });
    }
  } catch (e) {
    console.warn('[budget-capture-tx] dedup skipped:', (e as Error).message);
  }

  await writeTransactions(userId, db.id, [parsedTx]);
  return jsonWithCors(req, { ok: true, duplicate: false, transaction: parsedTx }, { status: 201 });
}

/** Existing transactions within ±`days` of `date`. A superset of the ±3-day
 *  window `findDuplicateTransactions` matches on. */
async function loadNearbyTransactions(
  databaseId: string,
  date: string,
  days: number,
): Promise<{ date: string; vendor: string; amount: number }[]> {
  const centre = new Date(date + 'T00:00:00').getTime();
  const windowMs = days * 24 * 60 * 60 * 1000;

  const pages = await prisma.page.findMany({
    where: { databaseId, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
  });

  const out: { date: string; vendor: string; amount: number }[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') continue;
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    const d = String(vals['Date'] ?? '').slice(0, 10);
    if (!isIsoDate(d)) continue;
    if (Math.abs(new Date(d + 'T00:00:00').getTime() - centre) > windowMs) continue;
    out.push({
      date: d,
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
    });
  }
  return out;
}
