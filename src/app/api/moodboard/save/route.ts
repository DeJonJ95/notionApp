import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOwner } from '@/lib/owner';
import { putBytes } from '@/lib/r2';

// Copy a single mood-board photo into the user's R2 bucket and return the
// permanent URL. Works for any provider — the only provider-specific work
// is pinging Unsplash's download_location (a required credit hop), which
// is gated behind the presence of the downloadEndpoint field.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session)) {
    return NextResponse.json({ error: 'Mood board is not available on this account yet.' }, { status: 403 });
  }
  const userId = (session.user as any).id;

  const { photoId, sourceUrl, downloadEndpoint, alt } = await req.json().catch(() => ({}));
  if (!sourceUrl || !photoId) {
    return NextResponse.json({ error: 'photoId and sourceUrl are required' }, { status: 400 });
  }

  // Fire-and-forget Unsplash download credit. Only Unsplash photos have
  // this; Pexels recommends credit (which we show in the UI) but doesn't
  // require an API ping, and The Met has no tracking.
  if (downloadEndpoint) {
    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
    if (unsplashKey) {
      fetch(downloadEndpoint, {
        headers: { Authorization: `Client-ID ${unsplashKey}`, 'Accept-Version': 'v1' },
      }).catch(() => {});
    }
  }

  // Pull the bytes from whichever CDN the photo lives on. All three
  // providers serve public URLs with permissive CORS, so this just works.
  const imgRes = await fetch(sourceUrl);
  if (!imgRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
  }
  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Cap at 8 MB so a single Met image (some are huge originals) doesn't
  // blow up the R2 bill on one save.
  if (buffer.byteLength > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  }

  const ext = contentType.includes('png') ? 'png' : 'jpg';
  // photoId arrives provider-prefixed (e.g. "unsplash:abc", "met:12345").
  // Replace the colon for a clean filename; the prefix still tags the
  // source in case we ever need to audit R2 keys.
  const safeId = String(photoId).replace(/[^a-zA-Z0-9._-]/g, '-');
  const objectKey = `${userId}/moodboard/${Date.now()}-${safeId}.${ext}`;
  const { publicUrl } = await putBytes(objectKey, buffer, contentType);

  return NextResponse.json({ url: publicUrl, alt: alt ?? '' });
}
