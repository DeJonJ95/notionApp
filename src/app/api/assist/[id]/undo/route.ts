import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { undoPlan, type UndoRecord } from '@/lib/assist/applyPlan';
import { toView } from '@/lib/assist/turn';
import type { AssistResult } from '@/lib/assist/types';

export const runtime = 'nodejs';

// Reverses the thread's last apply from the undo record stored with it.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const thread = await prisma.assistThread.findFirst({ where: { id: params.id, userId } });
  const undo = thread?.undo as UndoRecord | null | undefined;
  if (!thread || !undo) return NextResponse.json({ error: 'Nothing to undo' }, { status: 404 });

  if (!(await undoPlan(userId, undo))) return NextResponse.json({ error: 'That project no longer exists' }, { status: 404 });
  const result = thread.result as AssistResult | null;
  const marked = result?.intent === 'project' && result.applied ? { ...result, applied: { ...result.applied, undone: true } } : result;
  const saved = await prisma.assistThread.update({
    where: { id: thread.id },
    data: { undo: Prisma.DbNull, result: marked ?? Prisma.DbNull },
  });
  return NextResponse.json({ thread: toView(saved) });
}
