import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Fetches a YouTube video's caption track without an API key.
// Strategy: try InnerTube API (YouTube's internal player endpoint) first,
// then fall back to scraping the watch page HTML. Free and reasonably robust.

export const runtime = 'nodejs';

// This is YouTube's public web-client API key — embedded in their own JS
// bundle and used by every visitor. Not secret.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string; // 'asr' = auto-generated
  name?: any;
}

interface VideoInfo {
  tracks: CaptionTrack[];
  title: string;
}

// ── URL → video ID ─────────────────────────────────────────────────────
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
      if (u.pathname.startsWith('/live/')) return u.pathname.slice(6).split('/')[0] || null;
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// Walk an HTML string starting after `marker`, find the next `{`, and extract
// the full JSON object using brace counting (correctly handles nested objects
// and strings). Returns parsed JSON or null.
function extractJsonAfter(html: string, marker: string): any | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let i = idx + marker.length;
  while (i < html.length && html[i] !== '{') i++;
  if (i >= html.length) return null;
  const start = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
    } else {
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(html.slice(start, i + 1)); }
          catch { return null; }
        }
      }
    }
  }
  return null;
}

// ── Path 1: InnerTube API (preferred — stable, no consent page) ───────
async function fetchViaInnerTube(videoId: string): Promise<VideoInfo | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240101.00.00',
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const tracks: CaptionTrack[] =
      json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title: string =
      json?.videoDetails?.title ??
      json?.microformat?.playerMicroformatRenderer?.title?.simpleText ??
      'YouTube video';
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return { tracks, title };
  } catch {
    return null;
  }
}

// ── Path 2: HTML scrape (fallback) ─────────────────────────────────────
async function fetchViaWatchPage(videoId: string): Promise<VideoInfo | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // Bypass the EU cookie-consent page so we get the real watch page
        Cookie: 'CONSENT=YES+; PREF=hl=en',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Try the modern entry-point first, then the legacy global-var form
    const data =
      extractJsonAfter(html, 'ytInitialPlayerResponse =') ??
      extractJsonAfter(html, '"playerResponse":');
    if (!data) return null;
    const tracks: CaptionTrack[] =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title: string =
      data?.videoDetails?.title ??
      data?.microformat?.playerMicroformatRenderer?.title?.simpleText ??
      'YouTube video';
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return { tracks, title };
  } catch {
    return null;
  }
}

// ── Caption XML → plain text ───────────────────────────────────────────
async function fetchCaptionText(track: CaptionTrack): Promise<string> {
  const baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const r = await fetch(baseUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Caption fetch returned ${r.status}`);
  const xml = await r.text();
  const segments: string[] = [];
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/\n/g, ' ').trim();
    if (raw) segments.push(decodeEntities(raw));
  }
  return segments.join(' ').replace(/\s+/g, ' ').trim();
}

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack {
  // Prefer English manual captions, then English auto, then any
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ??
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode?.startsWith('en')) ??
    tracks[0]
  );
}

// ── Handler ────────────────────────────────────────────────────────────
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

  // Try InnerTube first; fall back to HTML scrape
  const info = (await fetchViaInnerTube(videoId)) ?? (await fetchViaWatchPage(videoId));
  if (!info) {
    return NextResponse.json(
      { error: 'No captions available for this video (or the video is private/age-restricted)' },
      { status: 404 }
    );
  }

  const track = pickBestTrack(info.tracks);
  let transcript: string;
  try {
    transcript = await fetchCaptionText(track);
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to fetch caption track' }, { status: 502 });
  }

  if (!transcript) {
    return NextResponse.json({ error: 'Caption track was empty' }, { status: 404 });
  }

  return NextResponse.json({ title: info.title, text: transcript, videoId });
}
