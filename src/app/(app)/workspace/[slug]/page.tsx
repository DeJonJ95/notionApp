import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NewPageButton } from '@/components/sidebar/NewPageButton';

export default async function WorkspacePage({
  params,
}: {
  params: { slug: string };
}) {
  const session = await auth();
  const userId = (session?.user as any)?.id;

  const workspace = await prisma.workspace.findFirst({
    where: { slug: params.slug, ownerId: userId },
    include: {
      pages: {
        where: { parentId: null, isArchived: false },
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!workspace) redirect('/');

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-10">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{workspace.icon}</span>
        <h1 className="text-3xl font-bold">{workspace.name}</h1>
      </div>
      <p className="text-muted mb-8 text-sm">
        {workspace.pages.length} top-level page{workspace.pages.length === 1 ? '' : 's'}
      </p>

      <NewPageButton workspaceId={workspace.id} />

      <ul className="mt-6 space-y-1">
        {workspace.pages.map((p) => (
          <li key={p.id}>
            <Link
              href={`/page/${p.id}`}
              className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface"
            >
              <span>{p.icon ?? '📄'}</span>
              <span className="truncate">{p.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
