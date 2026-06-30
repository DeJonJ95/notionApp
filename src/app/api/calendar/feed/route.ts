// Manage the user's calendar feed token — session-authenticated, used by
// the /calendar-feed settings page. One feed per user: POST replaces any
// existing token. The full subscribe URL (which embeds the secret) is
// only ever returned once, at generation time — we only store the hash.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateToken } from '@/lib/clipperAuth';

function feedUrl(req: NextRequest, token: string): string {
  const base = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '');
  return `${base}/api/calendar/${token}.ics`;
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await prisma.calendarToken.findFirst({
    where: { userId },
    select: { prefix: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  });

  // Full URL can't be reconstructed (only the hash is stored), so we just
  // report whether a feed exists plus its metadata.
  return NextResponse.json({
    hasFeed: !!row,
    prefix: row?.prefix ?? null,
    createdAt: row?.createdAt ?? null,
    lastUsedAt: row?.lastUsedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token, tokenHash, prefix } = generateToken();

  // Single feed per user — drop any previous tokens so old URLs stop working.
  await prisma.$transaction([
    prisma.calendarToken.deleteMany({ where: { userId } }),
    prisma.calendarToken.create({ data: { userId, tokenHash, prefix } }),
  ]);

  return NextResponse.json({ url: feedUrl(req, token), prefix });
}

export async function DELETE() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.calendarToken.deleteMany({ where: { userId } });
  return NextResponse.json({ ok: true });
}
