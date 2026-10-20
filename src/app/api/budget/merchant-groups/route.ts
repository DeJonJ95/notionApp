import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sessionUserId } from '@/lib/sessionUser';
import { GROUP_NAME, merchantGroups, normalizePattern } from '@/lib/budgetAssist/merchantGroups';

export const dynamic = 'force-dynamic';

const addSchema = z.object({
  group: z.string().trim().toLowerCase().regex(GROUP_NAME, 'Group names use lowercase letters, digits and underscores'),
  pattern: z.string().trim().min(2).max(60).refine((p) => normalizePattern(p).length >= 3, 'Use at least 3 letters or digits'),
});

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ groups: await merchantGroups(userId) });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  await prisma.merchantPattern.create({ data: { userId, groupName: parsed.data.group, pattern: parsed.data.pattern } });
  return NextResponse.json({ groups: await merchantGroups(userId) });
}

export async function DELETE(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  await prisma.merchantPattern.deleteMany({ where: { id, userId } });
  return NextResponse.json({ groups: await merchantGroups(userId) });
}
