import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PageEditor } from '@/components/editor/PageEditor';

export default async function PageRoute({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = (session?.user as any)?.id;

  const page = await prisma.page.findFirst({
    where: { id: params.id, authorId: userId },
  });
  if (!page) notFound();

  const doc = await prisma.block.findFirst({
    where: { pageId: page.id, type: 'document' },
  });

  return (
    <PageEditor
      page={{
        id: page.id,
        title: page.title,
        icon: page.icon,
        cover: page.cover,
        isFavorite: page.isFavorite,
      }}
      initialContent={(doc?.content as any) ?? null}
    />
  );
}
