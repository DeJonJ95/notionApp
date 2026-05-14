import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CanvasPageEditor } from '@/components/editor/CanvasPageEditor';
import type { CanvasBlockData } from '@/components/editor/CanvasPageEditor';

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
  }));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <CanvasPageEditor
        page={{
          id: page.id,
          title: page.title,
          icon: page.icon,
          cover: page.cover,
          isFavorite: page.isFavorite,
        }}
        initialBlocks={initialBlocks}
      />
    </div>
  );
}
