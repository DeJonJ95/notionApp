import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Fetches a YouTube video's caption track directly — no API key, no cost.
// Works for any video that has captions (auto-generated or manual).

export const runtime = 'nodejs';

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/embed/')) return u.pathname.slice(7).split('/')[0] || null;
      if (u.pathname.startsWith('/v/')) return u.pathname.slice(3).split('/')[0] || null;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.slice(8).split('/')[0] || null;
    }
  } catch {}
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Pull the captionTracks array out of the watch page's embedded JSON.
function extractCaptionTracks(html: string): Array<{ baseUrl: string; languageCode: string; name?: any }> {
  const marker = '"captionTracks":';
  const i = html.indexOf(marker);
  if (i === -1) return [];
  // Forward to the opening [
  const arrStart = html.indexOf('[', i);
  if (arrStart === -1) return [];
  // Walk forward to find the matching closing bracket (bracket-counting)
  let depth = 0;
  let arrEnd = -1;
  for (let k = arrStart; k < html.length; k++) {
    const c = html[k];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { arrEnd = k; break; }
    }
  }
  if (arrEnd === -1) return [];
  try {
    return JSON.parse(html.slice(arrStart, arrEnd + 1));
  } catch {
    return [];
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title>([^<]+)<\/title>/);
  if (!m) return 'YouTube video';
  return decodeEntities(m[1]).replace(/ - YouTube$/, '').trim();
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { url } = (await req.json()) as { url?: string };
  if (!url?.trim()) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: 'Could not parse YouTube URL or video ID' }, { status: 400 });
  }

  // 1. Fetch the watch page
  let html: string;
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        // Mimic a desktop browser so YouTube returns the full player config
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      return NextResponse.json({ error: `YouTube returned ${r.status}` }, { status: 502 });
    }
    html = await r.text();
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to fetch YouTube page' }, { status: 502 });
  }

  // 2. Find a caption track (prefer English)
  const tracks = extractCaptionTracks(html);
  if (tracks.length === 0) {
    return NextResponse.json(
      { error: 'No captions available for this video' },
      { status: 404 }
    );
  }
  const track =
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode?.startsWith('en')) ??
    tracks[0];

  // The baseUrl in the JSON is JSON-encoded with escaped slashes — unescape.
  const baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  // 3. Fetch the caption XML
  let xml: string;
  try {
    const r = await fetch(baseUrl, { cache: 'no-store' });
    if (!r.ok) {
      return NextResponse.json({ error: 'Failed to fetch caption track' }, { status: 502 });
    }
    xml = await r.text();
  } catch {
    return NextResponse.json({ error: 'Failed to fetch caption track' }, { status: 502 });
  }

  // 4. Parse <text>...</text> elements into a single transcript string
  const segments: string[] = [];
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/\n/g, ' ').trim();
    if (raw) segments.push(decodeEntities(raw));
  }

  if (segments.length === 0) {
    return NextResponse.json({ error: 'Caption track was empty' }, { status: 404 });
  }

  const transcript = segments.join(' ').replace(/\s+/g, ' ').trim();
  const title = extractTitle(html);

  return NextResponse.json({ title, text: transcript, videoId });
}
