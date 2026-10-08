import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { sessionUserId } from '@/lib/sessionUser';
import { NoProjectsMap } from '@/components/projects/NoProjectsMap';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const userId = await sessionUserId();
  if (!userId) redirect('/signin');
  const map = await prisma.database.findFirst({
    where: { workspace: { ownerId: userId }, views: { some: { type: 'map' } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (map) redirect(`/database/${map.id}`);
  return <NoProjectsMap />;
}
