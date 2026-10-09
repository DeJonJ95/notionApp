import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { startPhase } from '@/lib/projects/phase';

const schema = z.object({
  phase: z.string().trim().min(1).max(60),
  tasks: z.array(z.object({
    sourceId: z.string().optional(),
    title: z.string().trim().max(200).optional(),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })).max(200),
  moveIds: z.array(z.string()).max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const result = await startPhase(userId, { databaseId: params.id, ...parsed.data });
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'No Phase field on this database' }, { status: 404 });
}
