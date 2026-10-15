import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';
import { loadProject } from '@/lib/assist/projects';
import { keepValid } from '@/lib/assist/projectPlan';
import { applyPlan, undoStack } from '@/lib/assist/applyPlan';
import { toView } from '@/lib/assist/turn';
import type { AssistResult } from '@/lib/assist/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({ accept: z.array(z.number().int().min(0)).min(1).max(50) });

// Applies the ticked changes of the thread's stored plan. The plan comes from
// the server's own record, never the request, and is re-checked against the
// task list as it is now.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pick at least one change' }, { status: 400 });

  const thread = await prisma.assistThread.findFirst({ where: { id: params.id, userId } });
  const result = thread?.result as AssistResult | null | undefined;
  if (!thread || result?.intent !== 'project') return NextResponse.json({ error: 'Nothing to apply' }, { status: 404 });
  if (result.applied && !result.applied.undone) return NextResponse.json({ error: 'These changes were already applied' }, { status: 409 });

  const data = await loadProject(userId, result.target.databaseId, result.target.name);
  if (!data) return NextResponse.json({ error: 'That project no longer exists' }, { status: 404 });
  const changes = keepValid(result.changes, parsed.data.accept, data);
  if (!changes.length) return NextResponse.json({ error: 'Those tasks changed since the plan was made. Ask again.' }, { status: 409 });

  const undo = await applyPlan(userId, data, changes);
  const applied = { at: new Date().toISOString(), count: changes.length };
  const saved = await prisma.assistThread.update({
    where: { id: thread.id },
    data: { undo: [...undoStack(thread.undo), undo], result: { ...result, applied } },
  });
  return NextResponse.json({ thread: toView(saved) });
}
