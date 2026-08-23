import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { callDeepSeek } from '@/lib/jobs/deepseek';
import { logDeepSeek } from '@/lib/logUsage';
import { docText } from '@/lib/inbox';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';

export const runtime = 'nodejs';

const TRIAGE_SYSTEM = `You are a triage assistant for a personal workspace app. You are given one captured note and a list of the user's workspaces. Classify the note and suggest where it belongs.

Return ONLY a JSON object of this exact shape, no prose, no code fences:
{
  "kind": "task" | "note" | "idea" | "job" | "expense" | "event",
  "title": "a concise 3-8 word title",
  "summary": "one short sentence describing the item",
  "workspaceSlug": "<one of the provided workspace slugs, or 'keep' if none fit>"
}

Rules:
- Pick the single best workspace slug from the provided list. If nothing fits, use "keep".
- "title" must be plain text, no quotes or markdown.
- Do not invent facts not present in the note.`;

function buildUser(text: string, workspaces: { name: string; slug: string }[]): string {
  const list = workspaces.map((w) => `- ${w.slug} (${w.name})`).join('\n');
  return `Workspaces:\n${list || '(none)'}\n\nCaptured note:\n"""\n${text.slice(0, 4000)}\n"""`;
}

type Suggestion = { kind: string; title: string; summary: string; workspaceSlug: string };

function parseSuggestion(content: string): Suggestion | null {
  try {
    let txt = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
    const obj = JSON.parse(txt);
    if (!obj || typeof obj !== 'object') return null;
    return {
      kind: String(obj.kind ?? 'note'),
      title: String(obj.title ?? '').slice(0, 200),
      summary: String(obj.summary ?? '').slice(0, 400),
      workspaceSlug: String(obj.workspaceSlug ?? 'keep'),
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const budget = await checkDailyBudget(userId);
  if (!budget.ok) {
    return NextResponse.json(budgetExceededResponse(budget.spentUsd, budget.capUsd), { status: 429 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  const pageId = typeof body?.pageId === 'string' ? body.pageId : '';
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 });

  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: userId },
    include: { blocks: { orderBy: { position: 'asc' } } },
  });
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const text = [page.title, ...page.blocks.map((b) => docText(b.content))].filter(Boolean).join('\n');
  if (!text.trim()) return NextResponse.json({ error: 'Nothing to triage' }, { status: 400 });

  const workspaces = await prisma.workspace.findMany({
    where: { ownerId: userId, slug: { not: 'inbox' } },
    select: { name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  let content: string;
  let usage;
  try {
    const res = await callDeepSeek(apiKey, TRIAGE_SYSTEM, buildUser(text, workspaces), {
      json: true,
      maxTokens: 220,
      temperature: 0.1,
    });
    content = res.content;
    usage = res.usage;
  } catch {
    return NextResponse.json({ error: 'Triage failed — try again shortly' }, { status: 502 });
  }
  if (usage) logDeepSeek('inbox-triage', usage, userId);

  const suggestion = parseSuggestion(content);
  if (!suggestion) return NextResponse.json({ error: 'Could not read triage result' }, { status: 502 });

  // Resolve the suggested slug to a real, owned workspace id (or null = keep).
  const target = workspaces.find((w) => w.slug === suggestion.workspaceSlug);
  const targetWorkspace = target
    ? await prisma.workspace.findFirst({
        where: { ownerId: userId, slug: target.slug },
        select: { id: true, name: true },
      })
    : null;

  return NextResponse.json({ suggestion, targetWorkspace });
}
