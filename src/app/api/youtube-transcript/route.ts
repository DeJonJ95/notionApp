import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Fetches a YouTube video's caption track without an API key.
// Strategy: try several InnerTube client contexts in order, then fall back
// to scraping the watch page HTML. YouTube blocks some client/IP combos so
// rotating through clients is the most reliable free path.

export const runtime = 'nodejs';

// Public YouTube web-client API key embedded in their own JS bundle.
// Not secret. Used as the `key` query param for InnerTube.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
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

function extractJsonAfter(html: string, marker: string): any | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let i = idx + marker.length;
  while (i < html.length && html[i] !== '{') i++;
  if (i >= html.length) return null;
  const start = i;
  let depth = 0, inString = false, escape = false;
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

// ── InnerTube clients to try, in order ─────────────────────────────────
type ClientDef = {
  name: string;
  numericId: string;
  body: any;
  ua: string;
};

const CLIENTS: ClientDef[] = [
  {
    // IOS client — most permissive; often works when WEB doesn't from
    // datacenter IPs. Doesn't require visitor cookies.
    name: 'IOS',
    numericId: '5',
    body: {
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '19.32.8',
          deviceModel: 'iPhone14,3',
          osName: 'iOS',
          osVersion: '17.4.1.21E236',
          hl: 'en',
          gl: 'US',
        },
      },
    },
    ua: 'com.google.ios.youtube/19.32.8 (iPhone14,3; U; CPU iOS 17_4_1 like Mac OS X)',
  },
  {
    // ANDROID — secondary; sometimes works when IOS rate-limits.
    name: 'ANDROID',
    numericId: '3',
    body: {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '19.09.37',
          androidSdkVersion: 30,
          hl: 'en',
          gl: 'US',
        },
      },
    },
    ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
  },
  {
    // WEB_EMBEDDED_PLAYER — used for iframe embeds; often gets through.
    name: 'WEB_EMBEDDED_PLAYER',
    numericId: '56',
    body: {
      context: {
        client: {
          clientName: 'WEB_EMBEDDED_PLAYER',
          clientVersion: '1.20240101.00.00',
          hl: 'en',
          gl: 'US',
        },
        thirdParty: { embedUrl: 'https://www.youtube.com/' },
      },
    },
    ua:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    name: 'WEB',
    numericId: '1',
    body: {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
    },
    ua:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
];

async function fetchViaInnerTube(videoId: string, client: ClientDef): Promise<VideoInfo | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
          'Accept-Language': 'en-US,en;q=0.9',
          'X-YouTube-Client-Name': client.numericId,
          'X-YouTube-Client-Version':
            client.body.context.client.clientVersion,
        },
        body: JSON.stringify({ ...client.body, videoId }),
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      console.error(`[yt-transcript] InnerTube ${client.name} returned ${res.status}`);
      return null;
    }
    const json = await res.json();

    const status: string | undefined = json?.playabilityStatus?.status;
    if (status && status !== 'OK') {
      console.error(`[yt-transcript] InnerTube ${client.name}: playability=${status}`);
      // Continue anyway in case captions are still listed
    }

    const tracks: CaptionTrack[] =
      json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title: string =
      json?.videoDetails?.title ??
      json?.microformat?.playerMicroformatRenderer?.title?.simpleText ??
      'YouTube video';

    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.error(`[yt-transcript] InnerTube ${client.name}: 0 caption tracks`);
      return null;
    }
    console.log(`[yt-transcript] InnerTube ${client.name}: found ${tracks.length} tracks`);
    return { tracks, title };
  } catch (e: any) {
    console.error(`[yt-transcript] InnerTube ${client.name} threw:`, e?.message);
    return null;
  }
}

async function fetchViaWatchPage(videoId: string): Promise<VideoInfo | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+; PREF=hl=en',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[yt-transcript] watch-page returned ${res.status}`);
      return null;
    }
    const html = await res.text();
    const data =
      extractJsonAfter(html, 'ytInitialPlayerResponse =') ??
      extractJsonAfter(html, '"playerResponse":');
    if (!data) {
      console.error('[yt-transcript] watch-page: no playerResponse found');
      return null;
    }
    const tracks: CaptionTrack[] =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title: string =
      data?.videoDetails?.title ??
      data?.microformat?.playerMicroformatRenderer?.title?.simpleText ??
      'YouTube video';
    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.error('[yt-transcript] watch-page: 0 caption tracks');
      return null;
    }
    console.log(`[yt-transcript] watch-page: found ${tracks.length} tracks`);
    return { tracks, title };
  } catch (e: any) {
    console.error('[yt-transcript] watch-page threw:', e?.message);
    return null;
  }
}

async function fetchCaptionText(track: CaptionTrack): Promise<string> {
  const baseUrl = track.baseUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const r = await fetch(baseUrl, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
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
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ??
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode?.startsWith('en')) ??
    tracks[0]
  );
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

  // Walk the client list until one returns captions
  let info: VideoInfo | null = null;
  for (const client of CLIENTS) {
    info = await fetchViaInnerTube(videoId, client);
    if (info) break;
  }
  if (!info) {
    info = await fetchViaWatchPage(videoId);
  }
  if (!info) {
    return NextResponse.json(
      {
        error:
          'Could not get captions. The video may be private, age-restricted, region-locked, or have no captions.',
      },
      { status: 404 }
    );
  }

  const track = pickBestTrack(info.tracks);
  let transcript: string;
  try {
    transcript = await fetchCaptionText(track);
  } catch (e: any) {
    console.error('[yt-transcript] caption fetch failed:', e?.message);
    return NextResponse.json({ error: 'Failed to fetch caption track' }, { status: 502 });
  }

  if (!transcript) {
    return NextResponse.json({ error: 'Caption track was empty' }, { status: 404 });
  }

  return NextResponse.json({ title: info.title, text: transcript, videoId });
}
