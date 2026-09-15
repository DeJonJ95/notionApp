import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildAgenda } from '@/lib/agenda';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  return NextResponse.json(await buildAgenda(userId, date));
}
