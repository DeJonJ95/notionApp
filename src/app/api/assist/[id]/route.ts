import { NextRequest, NextResponse } from 'next/server';
import { sessionUserId } from '@/lib/sessionUser';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// "Start over": forget this to-do's conversation. Applied changes stay applied.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { count } = await prisma.assistThread.deleteMany({ where: { id: params.id, userId } });
  return NextResponse.json({ ok: count > 0 });
}
