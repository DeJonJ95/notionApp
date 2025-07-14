// Token management endpoints — used by the /clipper settings page.
// These are session-authenticated (regular user flow), not bearer-token,
// since users have to be signed into the app to manage their own tokens.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateToken } from '@/lib/clipperAuth';

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tokens = await prisma.clipperToken.findMany({
    where: { userId },
    select: { id: true, prefix: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
  const label = rawLabel.length > 0 && rawLabel.length <= 60 ? rawLabel : null;

  const { token, tokenHash, prefix } = generateToken();
  const row = await prisma.clipperToken.create({
    data: { userId, tokenHash, prefix, label },
    select: { id: true, prefix: true, label: true, createdAt: true },
  });

  // `token` is the raw secret. Returned ONLY on this initial response —
  // it's never stored in plaintext server-side and never retrievable
  // again. The settings page is responsible for showing it to the user
  // and prompting them to copy it.
  return NextResponse.json({ token, ...row });
}
