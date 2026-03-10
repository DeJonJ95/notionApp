// PWA share-target POST receiver (Android / desktop Chrome).
//
// The OS posts a multipart/form-data body here when the user picks Kove
// from the system share sheet. We can receive an actual image FILE
// (params.files[].name = "image" in manifest.json) and/or text/url.
//
// Flow:
//   • image file shared  → upload bytes to R2, redirect into the picker
//                          with ?img=<r2-url> so the note can be chosen.
//   • only a link shared → redirect into the picker with ?url=… so the
//                          existing og:image resolver handles it.
//
// NOTE: iOS Safari does not implement Web Share Target, so this path
// only ever fires on Android / desktop Chrome. iOS users go through the
// Shortcut → /api/clipper/upload-image instead.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { putBytes } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/avif': 'avif',
};

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  // Read the shared payload first so we can preserve it through sign-in.
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    /* no/garbled body — fall through to an empty picker */
  }

  const title = (form?.get('title') as string | null)?.trim() ?? '';
  const text = (form?.get('text') as string | null)?.trim() ?? '';
  const url = (form?.get('url') as string | null)?.trim() ?? '';
  const file = form?.get('image') as unknown;

  // Not signed in: bounce to sign-in, then back to the picker. We can't
  // carry a binary across the auth round-trip, so only text/url survive;
  // the user can re-share the file after signing in once.
  if (!userId) {
    const qs = new URLSearchParams();
    if (title) qs.set('title', title);
    if (text) qs.set('text', text);
    if (url) qs.set('url', url);
    const cb = `/clipper/share${qs.toString() ? `?${qs}` : ''}`;
    return redirectTo(`/signin?callbackUrl=${encodeURIComponent(cb)}`);
  }

  // If an actual image file came through, upload it to R2 now and hand the
  // picker a ready-to-save URL.
  if (file && typeof (file as Blob).arrayBuffer === 'function') {
    const blob = file as Blob;
    const contentType = blob.type || 'image/jpeg';
    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.byteLength > 0 && buffer.byteLength <= MAX_BYTES) {
        const ext = EXT_BY_TYPE[contentType] ?? 'jpg';
        const key = `${userId}/clipper/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        try {
          const { publicUrl } = await putBytes(key, buffer, contentType);
          const qs = new URLSearchParams({ img: publicUrl });
          if (title) qs.set('title', title);
          return redirectTo(`/clipper/share?${qs}`);
        } catch {
          /* fall through to the link path / empty picker */
        }
      }
    }
  }

  // No usable file — fall back to the link flow (og:image resolver).
  const qs = new URLSearchParams();
  if (title) qs.set('title', title);
  if (text) qs.set('text', text);
  if (url) qs.set('url', url);
  return redirectTo(`/clipper/share${qs.toString() ? `?${qs}` : ''}`);
}
