// Shop-the-look API: analyze a clipped image for shoppable items,
// search for links, store results, and serve them back.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyClipperAuth, corsPreflight, jsonWithCors } from '@/lib/clipperAuth';
import { analyzeImage } from '@/lib/vision/shopTheLook';
import { findShopLink } from '@/lib/shopSearch';
import { logCall, logGemini } from '@/lib/logUsage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

// POST: analyze image → find shop links → store → return
export async function POST(req: NextRequest) {
  const ctx = await verifyClipperAuth(req);
  if (!ctx) return jsonWithCors(req, { error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pageId = typeof body.pageId === 'string' ? body.pageId : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const blockId = typeof body.blockId === 'string' ? body.blockId : null;

  if (!pageId || !imageUrl) {
    return jsonWithCors(req, { error: 'pageId and imageUrl are required' }, { status: 400 });
  }

  // Ownership check
  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: ctx.userId },
    select: { id: true },
  });
  if (!page) return jsonWithCors(req, { error: 'Page not found or not yours' }, { status: 404 });

  // Verify Gemini key
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return jsonWithCors(req, { error: 'Vision service not configured' }, { status: 503 });
  }

  // ── Step 1: Vision analysis ────────────────────────────────────
  let detected: Awaited<ReturnType<typeof analyzeImage>>;
  try {
    detected = await analyzeImage(imageUrl, geminiKey);
    if (detected.usage) {
      await logGemini('shop-the-look-vision', detected.usage, ctx.userId);
    }
  } catch (e: any) {
    console.error('Shop-the-look vision failed:', e);
    return jsonWithCors(
      req,
      { error: e?.message ?? 'Vision analysis failed' },
      { status: 502 }
    );
  }

  if (detected.items.length === 0) {
    return jsonWithCors(req, { items: [], message: 'No identifiable products found in the image.' });
  }

  // ── Step 2: Find shop links (parallel capped at 5 to stay polite) ─
  const itemsWithLinks = await Promise.all(
    detected.items.slice(0, 5).map(async (item) => {
      const shop = await findShopLink(item.searchQuery);
      if (shop) {
        await logCall('shop-the-look', 'google-search', { userId: ctx.userId });
      }
      return {
        ...item,
        shopUrl: shop?.url ?? null,
        shopTitle: shop?.title ?? null,
      };
    })
  );

  // ── Step 3: Persist to DB ───────────────────────────────────────
  const created = await prisma.$transaction(
    itemsWithLinks.map((item) =>
      prisma.shopTheLookItem.create({
        data: {
          userId: ctx.userId,
          pageId,
          blockId,
          imageUrl,
          name: item.name.slice(0, 200),
          category: item.category?.slice(0, 50) ?? null,
          description: item.description?.slice(0, 500) ?? null,
          searchQuery: item.searchQuery.slice(0, 300),
          shopUrl: item.shopUrl?.slice(0, 500) ?? null,
          shopTitle: item.shopTitle?.slice(0, 300) ?? null,
          confidence: item.confidence ?? 0,
        },
      })
    )
  );

  return jsonWithCors(req, { items: created });
}

// GET: list shop-the-look items for a page
export async function GET(req: NextRequest) {
  const session = await (await import('@/lib/auth')).auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get('pageId');
  if (!pageId) return NextResponse.json({ error: 'pageId is required' }, { status: 400 });

  // Ownership
  const page = await prisma.page.findFirst({
    where: { id: pageId, authorId: userId },
    select: { id: true },
  });
  if (!page) return NextResponse.json({ error: 'Page not found or not yours' }, { status: 404 });

  const items = await prisma.shopTheLookItem.findMany({
    where: { pageId },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ items });
}
