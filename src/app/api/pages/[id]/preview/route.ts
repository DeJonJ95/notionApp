// Lightweight preview endpoint — returns just enough text from the first
// few blocks for a sidebar hover card. Avoids the full block payload that
// /api/pages/[id] returns so we don't ship megabytes per hover.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const SNIPPET_MAX = 240;
const BLOCKS_TO_SCAN = 4;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId, isArchived: false },
    select: {
      title: true,
      icon: true,
      updatedAt: true,
      blocks: {
        orderBy: { position: 'asc' },
        take: BLOCKS_TO_SCAN,
        select: { type: true, content: true },
      },
    },
  });
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Walk each block's TipTap content tree and collect text. Preserve
  // paragraph breaks so the snippet reads naturally instead of running
  // multiple thoughts together.
  let snippet = '';
  let firstImage: string | null = null;
  for (const b of page.blocks) {
    const text = extractText(b.content);
    if (text.trim()) {
      snippet += (snippet ? '\n' : '') + text.trim();
      if (snippet.length >= SNIPPET_MAX) break;
    }
    if (!firstImage) {
      const img = findFirstImage(b.content);
      if (img) firstImage = img;
    }
  }

  return NextResponse.json({
    title: page.title || 'Untitled',
    icon: page.icon ?? null,
    snippet: snippet.slice(0, SNIPPET_MAX).trim(),
    firstImage,
    updatedAt: page.updatedAt,
  });
}

// Walk a TipTap-style JSON tree and concatenate text leaves, with
// double-newline between block-level nodes so paragraphs read right.
function extractText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return node.text;
    const inner = node.content ? extractText(node.content) : '';
    const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock']);
    return blockTypes.has(node.type) ? `${inner}\n` : inner;
  }
  return '';
}

function findFirstImage(node: any): string | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (node.type === 'image' && node.attrs?.src) return node.attrs.src;
    if (node.content) return findFirstImage(node.content);
  }
  return null;
}
