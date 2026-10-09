import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { sessionUserId } from '@/lib/sessionUser';
import { NoProjectsMap } from '@/components/projects/NoProjectsMap';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const userId = await sessionUserId();
  if (!userId) redirect('/signin');
  // Every project's own task list has a map too; the Projects map is the one whose rows point at task databases.
  const maps = await prisma.database.findMany({
    where: { workspace: { ownerId: userId }, views: { some: { type: 'map' } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, properties: { select: { name: true, type: true } } },
  });
  const map = maps.find((m) => m.properties.some((p) => (p.type === 'text' && /task\s*(database|db)/i.test(p.name)) || (p.type === 'relation' && /^tasks$/i.test(p.name))));
  if (map) redirect(`/database/${map.id}`);
  return <NoProjectsMap />;
}
