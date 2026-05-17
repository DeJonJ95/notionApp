// Extension capture for pages without usable JobPosting JSON-LD. The content
// script reads the *rendered* DOM (which a server fetch can't for JS-heavy
// sites like Workday) and sends the visible text; here we LLM-extract the
// title/company if the client couldn't, then upsert. Bearer-token (or session)
// authenticated and CORS-enabled like the other extension endpoints.

import { NextRequest } from 'next/server';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { upsertListing } from '@/lib/jobs/ingest';
import {
  callDeepSeek, PARSE_PAGE_SYSTEM, buildParsePageUser, parseTitleCompany,
} from '@/lib/jobs/deepseek';
import { logCall, logDeepSeek } from '@/lib/logUsage';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  text: z.string().min(20).max(120_000),
});

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors(req, { error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { sourceUrl, applyUrl, location, text } = parsed.data;
  let title = parsed.data.title?.trim() || '';
  let company = parsed.data.company?.trim() || '';

  // Fill missing title/company from the page text. The JD text itself is used
  // verbatim (the model only names the role + company), so nothing is invented.
  if (!title || !company) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return jsonWithCors(req, { error: 'DeepSeek API key not configured' }, { status: 500 });
    try {
      const { content, usage } = await callDeepSeek(
        apiKey, PARSE_PAGE_SYSTEM, buildParsePageUser(text), { json: true, maxTokens: 200 },
      );
      if (usage) logDeepSeek('applykit-parse-page', usage, ctx.userId);
      const r = parseTitleCompany(content);
      title = title || r.title;
      company = company || r.company;
    } catch {
      /* fall through to the missing-fields check */
    }
  }
  if (!title || !company) {
    return jsonWithCors(req, { error: "Couldn't identify the role/company on that page." }, { status: 422 });
  }

  const listing = await upsertListing(ctx.userId, {
    sourceUrl,
    applyUrl: applyUrl ?? sourceUrl,
    company,
    title,
    location: location ?? null,
    description: text.slice(0, 60_000),
    rawJson: { via: 'extension-text' },
  });
  logCall('applykit', 'job-capture-text', { userId: ctx.userId });
  return jsonWithCors(req, { ok: true, listingId: listing.id });
}
