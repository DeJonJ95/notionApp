// Save an image from an external URL into a specific page's canvas.
// Called by the browser extension; bearer-token authenticated.

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { putBytes } from '@/lib/r2';
import { verifyClipperToken, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { logCall } from '@/lib/logUsage';

// Canvas placement constants — mirror what CanvasPageEditor uses
// client-side for new image uploads so clipped images land in the
// same column as everything else.
const DOC_X = 80;
const DOC_W_TEXT = 720;
const STACK_GAP = 250; // generous below-bottom gap so images don't overlap

// Server-side cap on image size. Pinterest images are typically 200KB–2MB
// originals; 8MB is plenty of headroom for unusual cases.
const MAX_BYTES = 8 * 1024 * 1024;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperToken(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pageId = typeof body.pageId === 'string' ? body.pageId : '';
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : '';
  const alt = typeof body.alt === 'string' ? body.alt.slice(0, 200) : '';

  if (!pageId || !sourceUrl) {
    return jsonWithCors(req, { error: 'pageId and sourceUrl are required' }, { status: 400 });
  }
  // Reject obviously bad URLs before we hit the network.
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return jsonWithCors(req, { error: 'Invalid sourceUrl' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return jsonWithCors(req, { error: 'sourceUrl must be http(s)' }, { status: 400 });
  }

  // Verify ownership — clipper can only save to pages owned by the same
  // user the token belongs to. No cross-user access ever.
  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: ctx.userId, isArchived: false },
    select: { id: true },
  });
  if (!page) return jsonWithCors(req, { error: 'Page not found' }, { status: 404 });

  // Fetch the image bytes server-side. Some hosts (Pinterest CDN, most
  // others we care about) require no auth; some block bots via UA, so
  // mimic a regular browser. If the fetch fails we surface a 502 so
  // the extension can show a useful error to the user.
  let imgRes: Response;
  try {
    imgRes = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8',
      },
    });
  } catch {
    return jsonWithCors(req, { error: 'Could not reach the image source' }, { status: 502 });
  }
  if (!imgRes.ok) {
    return jsonWithCors(req, { error: `Source returned ${imgRes.status}` }, { status: 502 });
  }
  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return jsonWithCors(req, { error: 'URL did not return an image' }, { status: 415 });
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return jsonWithCors(req, { error: 'Image too large' }, { status: 413 });
  }

  // Drop into R2. Path includes "clipper" so we can identify these in
  // the bucket later if we ever need to (e.g. retention, audit, billing).
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('gif')
    ? 'gif'
    : contentType.includes('webp')
    ? 'webp'
    : 'jpg';
  const objectKey = `${ctx.userId}/clipper/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { publicUrl } = await putBytes(objectKey, buffer, contentType);

  // Compute where to drop the new block on the canvas: just below the
  // bottommost existing block in the default doc column. This mirrors
  // what CanvasPageEditor's nextStackY() does client-side.
  const bottom = await prisma.block.aggregate({
    where: { pageId },
    _max: { canvasY: true },
  });
  const nextY = (bottom._max.canvasY ?? 0) + STACK_GAP;

  const block = await prisma.block.create({
    data: {
      pageId,
      type: 'text',
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: publicUrl, width: null, alt } }],
      },
      position: 0,
      canvasX: DOC_X,
      canvasY: nextY,
      canvasWidth: DOC_W_TEXT,
    },
  });

  // Update the page's updatedAt so it floats to the top of the recents
  // list next time the user opens the picker.
  await prisma.page.update({
    where: { id: pageId },
    data: { updatedAt: new Date() },
  }).catch(() => {});

  logCall('clipper', 'save-image', { userId: ctx.userId });

  return jsonWithCors(req, {
    ok: true,
    blockId: block.id,
    publicUrl,
  });
}
