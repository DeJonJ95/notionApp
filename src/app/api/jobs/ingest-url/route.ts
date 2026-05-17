import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { upsertListing } from '@/lib/jobs/ingest';
import { parseJobPostingFromHtml, stripHtml } from '@/lib/jobs/jsonld';
import {
  callDeepSeek, PARSE_PAGE_SYSTEM, buildParsePageUser, parseTitleCompany,
} from '@/lib/jobs/deepseek';
import { logDeepSeek } from '@/lib/logUsage';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({ url: z.string().url() });
const MAX_HTML = 3 * 1024 * 1024;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Block obvious SSRF targets — this route fetches a user-supplied URL.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '0.0.0.0') return true;
  return false;
}

// Capture a job from any URL: fetch the page server-side, prefer schema.org
// JobPosting JSON-LD (covers most ATS + company sites), fall back to cleaned
// page text + a DeepSeek title/company extraction.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid job URL is required' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(parsed.data.url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: 'That URL is not allowed' }, { status: 400 });
  }

  // Fetch the page (browser-like UA; many ATS block default fetch agents).
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({ error: `The page returned ${res.status}` }, { status: 502 });
    }
    html = (await res.text()).slice(0, MAX_HTML);
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach that page. Some sites (e.g. LinkedIn) block server fetches — try the extension or paste the description." },
      { status: 502 },
    );
  }

  const sourceUrl = target.toString();

  // 1) JSON-LD JobPosting — the high-quality, source-agnostic path.
  const jp = parseJobPostingFromHtml(html, sourceUrl);
  if (jp) {
    const listing = await upsertListing(userId, {
      sourceUrl,
      applyUrl: jp.applyUrl,
      company: jp.company,
      title: jp.title,
      description: jp.description,
      location: jp.location,
      rawJson: { via: 'jsonld' },
    });
    return NextResponse.json({ listing, via: 'jsonld' });
  }

  // 2) Fallback: cleaned page text + DeepSeek title/company extraction. The JD
  //    text is used verbatim (model only names the title + company).
  const text = stripHtml(html);
  if (text.length < 200) {
    return NextResponse.json(
      { error: "Couldn't find a job description on that page. Paste it manually instead." },
      { status: 422 },
    );
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });
  }

  let title = '', company = '';
  try {
    const { content, usage } = await callDeepSeek(
      apiKey, PARSE_PAGE_SYSTEM, buildParsePageUser(text), { json: true, maxTokens: 200 },
    );
    if (usage) logDeepSeek('applykit-parse-page', usage, userId);
    ({ title, company } = parseTitleCompany(content));
  } catch {
    /* fall through to the missing-fields error below */
  }
  if (!title || !company) {
    return NextResponse.json(
      { error: "Couldn't identify the role/company on that page. Paste the details manually." },
      { status: 422 },
    );
  }

  const listing = await upsertListing(userId, {
    sourceUrl,
    applyUrl: sourceUrl,
    company,
    title,
    description: text.slice(0, 60000),
    rawJson: { via: 'fallback' },
  });
  return NextResponse.json({ listing, via: 'fallback' });
}
