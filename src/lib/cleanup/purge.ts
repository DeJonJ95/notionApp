import { prisma } from '@/lib/prisma';

// Page.databaseId is onDelete: SetNull, so deleting a database alone would leave every row behind as a loose page.
export async function deleteDatabasesWithRows(userId: string, ids: string[]): Promise<number> {
  const owned = await prisma.database.findMany({
    where: { id: { in: ids }, workspace: { ownerId: userId } },
    select: { id: true },
  });
  const ownedIds = owned.map((d) => d.id);
  if (!ownedIds.length) return 0;
  await prisma.$transaction([
    prisma.page.deleteMany({ where: { databaseId: { in: ownedIds } } }),
    prisma.database.deleteMany({ where: { id: { in: ownedIds } } }),
  ]);
  return ownedIds.length;
}

export async function deletePages(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await prisma.page.deleteMany({ where: { id: { in: ids }, workspace: { ownerId: userId } } });
  return res.count;
}
