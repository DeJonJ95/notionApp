import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { callDeepSeek } from '@/lib/jobs/deepseek';
import { logDeepSeek } from '@/lib/logUsage';
import { findOrCreateBudgetDb } from '@/lib/budgetDb';
import { docText } from '@/lib/inbox';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';

export const runtime = 'nodejs';
export const maxDuration = 60;

const REVIEW_SYSTEM = `You write a brief, warm evening reflection for someone's personal journal, grounded in the day's activity they give you (journal notes, tasks, spending, job-hunt moves).

Return ONLY a JSON object, no prose, no code fences:
{
  "reflection": "2-4 sentence supportive reflection on how the day went",
  "priorities": ["up to 3 short action items for tomorrow"]
}

Rules:
- Base everything on the provided data. Do NOT invent events, numbers, or tasks.
- If there is little data, keep it short and gentle rather than padding.
- priorities: 0 to 3 items, each a short imperative phrase (e.g. "Follow up with Acme recruiter").
- Encouraging and concrete. No preamble, no sign-off.`;

type TaskStats = { done: number; total: number };

function taskStats(content: any): TaskStats {
  let done = 0;
  let total = 0;
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === 'taskItem') {
      total++;
      if (n.attrs?.checked) done++;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return { done, total };
}

function parseReview(content: string): { reflection: string; priorities: string[] } | null {
  try {
    let txt = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
    const obj = JSON.parse(txt);
    const reflection = String(obj?.reflection ?? '').trim();
    const priorities = Array.isArray(obj?.priorities)
      ? obj.priorities.map((p: unknown) => String(p).trim()).filter(Boolean).slice(0, 3)
      : [];
    if (!reflection && priorities.length === 0) return null;
    return { reflection, priorities };
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
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!pageId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'pageId and a valid date are required' }, { status: 400 });
  }

  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: userId },
    include: { blocks: { orderBy: { position: 'asc' } } },
  });
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 1. Journal text + task progress written today.
  const journalText = page.blocks.map((b) => docText(b.content)).filter(Boolean).join('\n');
  const tasks = page.blocks.reduce<TaskStats>(
    (acc, b) => {
      const s = taskStats(b.content);
      return { done: acc.done + s.done, total: acc.total + s.total };
    },
    { done: 0, total: 0 }
  );

  // 2. Budget: today's transactions.
  let budgetLine = 'No transactions recorded today.';
  try {
    const db = await findOrCreateBudgetDb(userId);
    const pages = await prisma.page.findMany({
      where: { databaseId: db.id, isArchived: false },
      include: { properties: { include: { property: { select: { name: true } } } } },
    });
    let spent = 0;
    let earned = 0;
    let count = 0;
    for (const p of pages) {
      const vals: Record<string, any> = {};
      for (const pv of p.properties) vals[pv.property.name] = pv.value;
      if (String(vals['Type'] ?? '') === 'Budget') continue;
      if (String(vals['Date'] ?? '').slice(0, 10) !== date) continue;
      const amt = Math.abs(Number(vals['Amount'] ?? 0));
      if (!amt) continue;
      count++;
      if (String(vals['Type'] ?? '') === 'Income') earned += amt;
      else spent += amt;
    }
    if (count > 0) {
      budgetLine = `${count} transaction(s): spent $${spent.toFixed(2)}${earned ? `, earned $${earned.toFixed(2)}` : ''}.`;
    }
  } catch {
    // budget is optional context — ignore failures
  }

  // 3. Job-hunt events today.
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const events = await prisma.applicationEvent.findMany({
    where: { application: { userId }, createdAt: { gte: start, lt: end } },
    include: { application: { include: { listing: { select: { company: true, title: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const jobLines = events.map((e) => {
    const l = e.application?.listing;
    const who = l ? `${l.company} — ${l.title}` : 'an application';
    return `Moved ${who} to ${e.toStatus}`;
  });

  const userPrompt = `Date: ${date}

Journal notes:
"""
${journalText.slice(0, 4000) || '(nothing written)'}
"""

Tasks: ${tasks.done}/${tasks.total} checked off.
Budget: ${budgetLine}
Job hunt: ${jobLines.length ? jobLines.join('; ') : 'no changes'}`;

  let content: string;
  let usage;
  try {
    const res = await callDeepSeek(apiKey, REVIEW_SYSTEM, userPrompt, {
      json: true,
      maxTokens: 400,
      temperature: 0.4,
    });
    content = res.content;
    usage = res.usage;
  } catch {
    return NextResponse.json({ error: 'Review failed — try again shortly' }, { status: 502 });
  }
  if (usage) logDeepSeek('journal-review', usage, userId);

  const review = parseReview(content);
  if (!review) return NextResponse.json({ error: 'Could not read the review' }, { status: 502 });

  // Build one review block: heading + reflection + optional priorities checklist.
  const nodes: any[] = [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🌙 Evening review' }] },
  ];
  if (review.reflection) {
    nodes.push({ type: 'paragraph', content: [{ type: 'text', text: review.reflection }] });
  }
  if (review.priorities.length) {
    nodes.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tomorrow’s priorities' }] });
    nodes.push({
      type: 'taskList',
      content: review.priorities.map((p) => ({
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: p }] }],
      })),
    });
  }

  const maxPos = page.blocks.reduce((m, b) => Math.max(m, b.position ?? 0), 0);
  await prisma.block.create({
    data: {
      pageId: page.id,
      type: 'text',
      content: { type: 'doc', content: nodes } as any,
      position: maxPos + 1024,
      canvasX: 60,
      canvasY: 60,
      canvasWidth: 480,
    },
  });

  return NextResponse.json({ ok: true, reflection: review.reflection, priorities: review.priorities });
}
