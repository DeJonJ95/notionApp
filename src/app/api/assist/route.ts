import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';
import { assistConfigured } from '@/lib/assist/llm';
import { runTurn, toView } from '@/lib/assist/turn';
import { todoKey } from '@/lib/assist/todoKey';

export const runtime = 'nodejs';
export const maxDuration = 60;

const turnSchema = z.object({
  pageId: z.string().min(1),
  todo: z.string().trim().min(2).max(500),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  linkedRowId: z.string().nullish(),
  message: z.string().trim().max(1000).optional(),
});

// ?pageId= lists which to-dos on a page have a thread; adding &todo= returns that thread.
export async function GET(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pageId = req.nextUrl.searchParams.get('pageId') ?? '';
  const todo = req.nextUrl.searchParams.get('todo');
  if (todo) {
    const t = await prisma.assistThread.findUnique({ where: { userId_pageId_todoKey: { userId, pageId, todoKey: todoKey(todo) } } });
    return NextResponse.json({ thread: t ? toView(t) : null });
  }
  const rows = await prisma.assistThread.findMany({ where: { userId, pageId }, select: { todoKey: true, intent: true } });
  return NextResponse.json({ threads: rows });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!assistConfigured()) return NextResponse.json({ error: 'No AI provider is configured' }, { status: 500 });
  const parsed = turnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const budget = await checkDailyBudget(userId);
  if (!budget.ok) return NextResponse.json(budgetExceededResponse(budget.spentUsd, budget.capUsd), { status: 429 });

  const page = await prisma.page.findFirst({ where: { id: parsed.data.pageId, workspace: { ownerId: userId } }, select: { id: true } });
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  try {
    const thread = await runTurn({ ...parsed.data, userId, firstName: (user?.name ?? '').split(/\s+/)[0] });
    return NextResponse.json({ thread: toView(thread) });
  } catch (e) {
    console.error('assist turn failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The assistant failed. Try again.' }, { status: 502 });
  }
}
