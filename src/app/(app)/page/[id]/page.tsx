import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CanvasPageEditor } from '@/components/editor/CanvasPageEditor';
import type { CanvasBlockData } from '@/components/editor/CanvasPageEditor';
import { RecentPageTracker } from '@/components/RecentPageTracker';
import { ShopTheLookPanel } from '@/components/shop/ShopTheLookPanel';

// Clipped images live inside a block's ProseMirror doc as
// { type: 'image', attrs: { src } } nodes. Walk the doc so the shop
// panel knows which images this page actually holds, and can offer to
// analyze one long after the clip-time toast is gone.
function collectImages(blocks: CanvasBlockData[]): { src: string; blockId: string }[] {
  const out: { src: string; blockId: string }[] = [];
  const seen = new Set<string>();

  function walk(node: any, blockId: string) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      const src = node.attrs.src;
      if (!seen.has(src)) {
        seen.add(src);
        out.push({ src, blockId });
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, blockId);
    }
  }

  for (const b of blocks) walk(b.content, b.id);
  return out;
}

export default async function PageRoute({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId },
  });
  if (!page) notFound();

  const blocks = await prisma.block.findMany({
    where: { pageId: page.id },
    orderBy: { position: 'asc' },
  });

  const initialBlocks: CanvasBlockData[] = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    content: b.content as any,
    canvasX: b.canvasX ?? 60,
    canvasY: b.canvasY ?? 60,
    canvasWidth: b.canvasWidth ?? 420,
    position: b.position,
  }));

  const images = collectImages(initialBlocks);

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <RecentPageTracker id={page.id} title={page.title} icon={page.icon} />
      <CanvasPageEditor
        page={{
          id: page.id,
          title: page.title,
          icon: page.icon,
          cover: page.cover,
          isFavorite: page.isFavorite,
        }}
        initialBlocks={initialBlocks}
        initialViewMode={page.viewMode ?? 'document'}
      />
      <div className="px-6 pb-6 max-w-3xl mx-auto w-full">
        <ShopTheLookPanel pageId={page.id} images={images} />
      </div>
    </div>
  );
}
