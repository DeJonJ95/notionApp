// Resolve a shared URL into an image URL by scraping og:image-style
// meta tags. Used by the PWA share-target receiver: most apps share
// page URLs (Pinterest, Tumblr, fashion blogs) rather than the image
// itself, so we need to dig the actual image out of the HTML.
//
// Session-authenticated (not bearer-token) because it's called by the
// notes-app's own /clipper/share page, which runs in the user's
// normal authenticated browser session.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const MAX_HTML_BYTES = 1024 * 1024; // 1MB ceiling on the HTML we'll scan

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sourceUrl = req.nextUrl.searchParams.get('url')?.trim();
  if (!sourceUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'URL must be http(s)' }, { status: 400 });
  }

  // Shortcut: the shared URL IS an image (direct link, not a page).
  // Pinterest's "Copy image link" produces these, as do most image
  // hosts. Skip the HTML scrape and return the URL as-is.
  if (/\.(jpe?g|png|gif|webp|avif)(?:\?|$)/i.test(parsed.pathname)) {
    return NextResponse.json({ imageUrl: sourceUrl, title: '', isDirectImage: true });
  }

  // Otherwise fetch the page and parse out og:image / twitter:image.
  let html: string;
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        // Some sites (Pinterest is the prime offender) serve very
        // different markup to bots vs browsers — claim to be a normal
        // Chrome so we get the og:image they expect users to see.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Source returned ${res.status}` },
        { status: 502 }
      );
    }
    // Cap how much HTML we read — og tags live in <head>, well within 1MB.
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
    html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    return NextResponse.json({ error: 'Could not fetch the page' }, { status: 502 });
  }

  // Resolution priority: og:image > twitter:image > first reasonably-
  // sized <img>. Last-resort makes us robust on pages without proper
  // OG tags (some Tumblr posts, indie blogs).
  const ogImage = pickMeta(html, [
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
  ]);
  const ogTitle = pickMeta(html, [
    /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
    /<title>([^<]+)<\/title>/i,
  ]);

  // Resolve relative URLs against the page's origin.
  let imageUrl = ogImage ?? '';
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    try { imageUrl = new URL(imageUrl, parsed).toString(); } catch { /* keep raw */ }
  }

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'No image found on this page', title: ogTitle ?? '' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    imageUrl,
    title: ogTitle ?? '',
    isDirectImage: false,
  });
}

function pickMeta(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

// Just enough to turn &amp; / &quot; / &#39; back into their characters,
// which show up in real-world OG tags from blogs and Pinterest.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}
