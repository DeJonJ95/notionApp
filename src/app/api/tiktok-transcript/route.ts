import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// TikTok transcript via Supadata. Unlike YouTube there's no reliable free
// fallback — TikTok auto-captions aren't exposed via public APIs and
// downloading the audio for Whisper requires a video-download service.
// So this route is Supadata-only.

export const runtime = 'nodejs';

function looksLikeTikTokUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return /(^|\.)tiktok\.com$/i.test(u.hostname) || /(^|\.)vm\.tiktok\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function fetchViaSupadata(url: string): Promise<{ text: string; title?: string } | null> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.supadata.ai/v1/tiktok/transcript?url=${encodeURIComponent(url)}&text=true`,
      { headers: { 'x-api-key': key }, cache: 'no-store' }
    );
    if (!r.ok) {
      console.error(`[tt-transcript] Supadata returned ${r.status}: ${await r.text().catch(() => '')}`);
      return null;
    }
    const json = await r.json();
    const text: string = json?.content ?? json?.text ?? '';
    if (!text.trim()) {
      console.error('[tt-transcript] Supadata: empty content');
      return null;
    }
    const title: string | undefined = json?.title ?? json?.metadata?.title;
    console.log('[tt-transcript] Supadata: success');
    return { text: text.trim(), title };
  } catch (e: any) {
    console.error('[tt-transcript] Supadata threw:', e?.message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.SUPADATA_API_KEY) {
    return NextResponse.json(
      { error: 'TikTok transcription requires SUPADATA_API_KEY to be configured.' },
      { status: 503 }
    );
  }

  const { url } = (await req.json()) as { url?: string };
  if (!url?.trim()) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

  if (!looksLikeTikTokUrl(url)) {
    return NextResponse.json({ error: 'Not a TikTok URL.' }, { status: 400 });
  }

  const sup = await fetchViaSupadata(url.trim());
  if (!sup) {
    return NextResponse.json(
      {
        error:
          'No transcript available. Many TikToks have no caption track and TikTok blocks server-side audio downloads — try a video with visible captions.',
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    title: sup.title ?? 'TikTok video',
    text: sup.text,
  });
}
