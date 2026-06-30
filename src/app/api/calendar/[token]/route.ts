// Public ICS feed endpoint. Calendar apps subscribe to this URL and
// re-poll it on their own schedule (Google ~every 8-24h, Outlook
// similar). No session cookie — the secret token lives in the URL path,
// looked up by its SHA-256 hash. A trailing ".ics" is accepted because
// some clients insist the URL end in .ics.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/clipperAuth';
import { buildIcsForUser } from '@/lib/calendarFeed';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.ics$/i, '').trim();
  if (!token) return new NextResponse('Not found', { status: 404 });

  const row = await prisma.calendarToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true },
  });
  if (!row) return new NextResponse('Not found', { status: 404 });

  // Fire-and-forget so the feed fetch stays fast.
  prisma.calendarToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const baseUrl = (process.env.NEXTAUTH_URL || new URL(_req.url).origin).replace(/\/$/, '');
  const ics = await buildIcsForUser(row.userId, baseUrl);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="kove.ics"',
      // Let clients revalidate; the feed is cheap and changes often.
      'Cache-Control': 'no-cache, max-age=0',
    },
  });
}
