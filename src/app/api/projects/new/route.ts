import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/sessionUser';
import { createProjectWithTasks } from '@/lib/projects/newProject';

const schema = z.object({ mapDbId: z.string(), title: z.string().trim().min(1).max(200).default('Untitled project') });

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const made = await createProjectWithTasks(userId, parsed.data.mapDbId, parsed.data.title);
  return made ? NextResponse.json(made) : NextResponse.json({ error: 'Not a projects map' }, { status: 404 });
}
