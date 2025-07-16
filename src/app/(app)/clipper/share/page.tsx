// PWA share-target receiver. When the user picks the installed Kove
// app from their phone's Share sheet (in Pinterest, Tumblr, Safari,
// the iOS Photos app, etc.), the OS opens this page with the shared
// content as query params.
//
// Web Share Target params (as declared in public/manifest.json):
//   title — page/share title
//   text  — descriptive text (sometimes contains the URL on iOS)
//   url   — the page URL being shared
//
// iOS Safari has a quirk where it puts the URL in `text` instead of
// `url`, so we hunt for an http(s) URL in either field.

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ShareReceiver } from '@/components/clipper/ShareReceiver';

export const dynamic = 'force-dynamic'; // never cache; the params drive the UI

function findUrl(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (!v) continue;
    const m = v.match(/https?:\/\/\S+/);
    if (m) return m[0].replace(/[)\].,;'"]+$/, ''); // strip trailing punctuation
  }
  return '';
}

export default async function ClipperSharePage({
  searchParams,
}: {
  searchParams: { title?: string; text?: string; url?: string };
}) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    // Preserve the share params through the sign-in round trip so the
    // user lands back here with everything intact.
    const params = new URLSearchParams();
    if (searchParams.title) params.set('title', searchParams.title);
    if (searchParams.text) params.set('text', searchParams.text);
    if (searchParams.url) params.set('url', searchParams.url);
    const cb = `/clipper/share${params.toString() ? `?${params.toString()}` : ''}`;
    redirect(`/signin?callbackUrl=${encodeURIComponent(cb)}`);
  }

  const sharedUrl = findUrl(searchParams.url, searchParams.text);
  const sharedTitle = searchParams.title ?? '';

  return <ShareReceiver initialUrl={sharedUrl} initialTitle={sharedTitle} />;
}
