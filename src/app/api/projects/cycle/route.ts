import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { previewCycle, runCycle } from '@/lib/projects/startCycle';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  mapDbId: z.string(),
  projectIds: z.array(z.string()).min(1).max(50),
  label: z.string().trim().max(60).default(''),
  names: z.record(z.string().trim().max(200)).optional(),
  fromDate: date.optional(),
  toDate: date.optional(),
  dryRun: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { dryRun, ...input } = parsed.data;

  if (dryRun) {
    const preview = await previewCycle(userId, input);
    return preview ? NextResponse.json(preview) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!input.fromDate || !input.toDate) return NextResponse.json({ error: 'fromDate and toDate required' }, { status: 400 });
  const result = await runCycle(userId, input);
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
