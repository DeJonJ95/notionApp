// Upload an image FILE (multipart/form-data) into a specific page's
// canvas. Unlike save-image (which takes a remote URL and fetches it),
// this receives the raw bytes directly — used by:
//   • the iOS Shortcut share-sheet flow (bearer-token authed)
//   • the PWA POST share-target on Android/desktop Chrome (session authed)
//
// Auth accepts EITHER a clipper bearer token OR a NextAuth session,
// via verifyClipperAuth.

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { putBytes } from '@/lib/r2';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { logCall } from '@/lib/logUsage';

// Canvas placement constants — mirror save-image / CanvasPageEditor so
// uploaded images land in the same column as everything else.
const DOC_X = 80;
const DOC_W_TEXT = 720;
const STACK_GAP = 250;

// Match save-image's ceiling so behaviour is consistent across both paths.
const MAX_BYTES = 8 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonWithCors(req, { error: 'Expected multipart/form-data' }, { status: 400 });
  }

  // pageId can come from the form body or the query string (the Shortcut
  // sends it in the body; the share-target redirect may carry it in the URL).
  const pageId =
    (form.get('pageId') as string | null)?.trim() ||
    req.nextUrl.searchParams.get('pageId')?.trim() ||
    '';
  const alt = ((form.get('alt') as string | null) ?? '').slice(0, 200);

  // Accept the file under a few common field names so the Shortcut and the
  // share-target manifest (`files[].name = "image"`) both work.
  const file =
    (form.get('image') as unknown) ||
    (form.get('file') as unknown) ||
    (form.getAll('files')[0] as unknown);

  if (!pageId) {
    return jsonWithCors(req, { error: 'pageId is required' }, { status: 400 });
  }
  if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
    return jsonWithCors(req, { error: 'No image file provided' }, { status: 400 });
  }

  const blob = file as Blob;
  const contentType = blob.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return jsonWithCors(req, { error: 'Uploaded file is not an image' }, { status: 415 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.byteLength === 0) {
    return jsonWithCors(req, { error: 'Empty file' }, { status: 400 });
  }
  if (buffer.byteLength > MAX_BYTES) {
    return jsonWithCors(req, { error: 'Image too large' }, { status: 413 });
  }

  // Ownership check — only ever write to a page the authed user owns.
  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: ctx.userId, isArchived: false },
    select: { id: true },
  });
  if (!page) return jsonWithCors(req, { error: 'Page not found' }, { status: 404 });

  const ext = EXT_BY_TYPE[contentType] ?? 'jpg';
  const objectKey = `${ctx.userId}/clipper/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const { publicUrl } = await putBytes(objectKey, buffer, contentType);

  // Drop the block just below the bottommost existing block.
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

  await prisma.page
    .update({ where: { id: pageId }, data: { updatedAt: new Date() } })
    .catch(() => {});

  logCall('clipper', 'upload-image', { userId: ctx.userId });

  return jsonWithCors(req, { ok: true, blockId: block.id, publicUrl });
}
