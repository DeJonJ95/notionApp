// Ownership checks for workspace data. Everything a user owns hangs off a
// workspace they own, so each check resolves the record through
// workspace.ownerId. Routes must call these before writing or reading by an
// id that came from the request, including ids a write would link to.

import { prisma } from '@/lib/prisma';

export async function ownsWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  return !!(await prisma.workspace.findFirst({ where: { id: workspaceId, ownerId: userId }, select: { id: true } }));
}

export function ownedDatabase(userId: string, databaseId: string) {
  return prisma.database.findFirst({ where: { id: databaseId, workspace: { ownerId: userId } }, select: { id: true, workspaceId: true } });
}

export function ownedPage(userId: string, pageId: string) {
  return prisma.page.findFirst({ where: { id: pageId, workspace: { ownerId: userId } }, select: { id: true, databaseId: true, workspaceId: true } });
}

/** A relation property may only point at one of the user's own databases. */
export async function relationTargetOk(userId: string, type: unknown, formula: unknown): Promise<boolean> {
  if (type !== 'relation' || typeof formula !== 'string') return true;
  let target: unknown;
  try {
    target = (JSON.parse(formula) as { targetDatabaseId?: unknown })?.targetDatabaseId;
  } catch {
    return true;
  }
  return typeof target !== 'string' || !!(await ownedDatabase(userId, target));
}

type Links = { workspaceId?: string | null; databaseId?: string | null; parentId?: string | null };

/** True when every workspace, database and parent page a page would link to is the user's. */
export async function linksOwned(userId: string, links: Links): Promise<boolean> {
  const checks = [
    links.workspaceId ? ownsWorkspace(userId, links.workspaceId) : true,
    links.databaseId ? ownedDatabase(userId, links.databaseId).then(Boolean) : true,
    links.parentId ? ownedPage(userId, links.parentId).then(Boolean) : true,
  ];
  return (await Promise.all(checks)).every(Boolean);
}
