import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { undoPlan, undoStack } from '@/lib/assist/applyPlan';
import { toView } from '@/lib/assist/turn';
import type { AssistResult } from '@/lib/assist/types';

export const runtime = 'nodejs';

// Reverses the thread's newest apply from the undo records stored with it.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const thread = await prisma.assistThread.findFirst({ where: { id: params.id, userId } });
  const stack = undoStack(thread?.undo ?? null);
  const undo = stack[stack.length - 1];
  if (!thread || !undo) return NextResponse.json({ error: 'Nothing to undo' }, { status: 404 });

  if (!(await undoPlan(userId, undo))) return NextResponse.json({ error: 'That project no longer exists' }, { status: 404 });
  const result = thread.result as AssistResult | null;
  const marked = result?.intent === 'project' && result.applied ? { ...result, applied: { ...result.applied, undone: true } } : result;
  const saved = await prisma.assistThread.update({
    where: { id: thread.id },
    data: { undo: stack.length > 1 ? stack.slice(0, -1) : Prisma.DbNull, result: marked ?? Prisma.DbNull },
  });
  return NextResponse.json({ thread: toView(saved) });
}
