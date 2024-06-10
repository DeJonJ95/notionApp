import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUploadUrl } from '@/lib/r2';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const { filename, contentType } = await req.json();
  if (!filename || !contentType)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const key = `${userId}/${Date.now()}-${safeName}`;
  const { url, publicUrl } = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl: url, publicUrl });
}
