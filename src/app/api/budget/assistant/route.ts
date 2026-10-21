import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';
import { answerBudgetQuestion } from '@/lib/budgetAssist/assistant';
import { AssistantError, deepseekConfigured } from '@/lib/budgetAssist/deepseekTools';

export const runtime = 'nodejs';
export const maxDuration = 120;

const bodySchema = z.object({
  question: z.string().trim().min(2).max(500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
});

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!deepseekConfigured()) return NextResponse.json({ error: 'No AI provider is configured' }, { status: 500 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const budget = await checkDailyBudget(userId);
  if (!budget.ok) return NextResponse.json(budgetExceededResponse(budget.spentUsd, budget.capUsd), { status: 429 });

  try {
    return NextResponse.json(await answerBudgetQuestion({ userId, ...parsed.data }));
  } catch (e) {
    console.error('budget assistant failed:', e);
    return NextResponse.json({ error: e instanceof AssistantError ? e.message : 'The assistant failed. Try again.' }, { status: 502 });
  }
}
