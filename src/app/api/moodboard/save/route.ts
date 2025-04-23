import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { putBytes } from '@/lib/r2';

// Copy a single Unsplash photo into the user's R2 bucket and return the
// permanent URL. Also pings Unsplash's `download_location` so the photographer
// gets credit (required by their API guidelines — they don't care if we save
// the bytes, but they DO care that we report the download).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return NextResponse.json({ error: 'Mood board not configured' }, { status: 503 });

  const { photoId, sourceUrl, downloadEndpoint, alt } = await req.json().catch(() => ({}));
  if (!sourceUrl || !photoId) {
    return NextResponse.json({ error: 'photoId and sourceUrl are required' }, { status: 400 });
  }

  // Fire-and-forget the download tracking ping — never block the user on it.
  if (downloadEndpoint) {
    fetch(downloadEndpoint, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
    }).catch(() => {});
  }

  // Pull the bytes. We use the Unsplash CDN URL the client already saw,
  // so the dimensions/quality matches the user's selection.
  const imgRes = await fetch(sourceUrl);
  if (!imgRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
  }
  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Cap at 8 MB to keep R2 bills sane — Unsplash full-size photos
  // are usually 2–5 MB so this is generous, but a hard ceiling protects us.
  if (buffer.byteLength > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  }

  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const objectKey = `${userId}/moodboard/${Date.now()}-${photoId}.${ext}`;
  const { publicUrl } = await putBytes(objectKey, buffer, contentType);

  return NextResponse.json({ url: publicUrl, alt: alt ?? '' });
}
