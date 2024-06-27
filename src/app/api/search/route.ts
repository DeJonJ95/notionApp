import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const userId = (session.user as any).id;

  const workspaces = await prisma.workspace.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true },
  });
  const workspaceIds = workspaces.map((w) => w.id);
  const workspaceMap = Object.fromEntries(workspaces.map((w) => [w.id, w.name]));

  if (!q) {
    // No query — return recently updated pages for quick navigation
    const recent = await prisma.page.findMany({
      where: { workspaceId: { in: workspaceIds }, isArchived: false },
      select: { id: true, title: true, icon: true, workspaceId: true, databaseId: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return NextResponse.json({
      results: recent.map((p) => ({
        id: p.id,
        title: p.title || 'Untitled',
        icon: p.icon ?? '📄',
        workspaceName: workspaceMap[p.workspaceId] ?? '',
        databaseId: p.databaseId,
        matchType: 'recent' as const,
      })),
    });
  }

  // 1. Search by title (always runs, fast)
  const titleHits = await prisma.page.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      isArchived: false,
      title: { contains: q, mode: 'insensitive' },
    },
    select: { id: true, title: true, icon: true, workspaceId: true, databaseId: true },
    orderBy: { updatedAt: 'desc' },
    take: 15,
  });

  // 2. Search block content via raw SQL (graceful fallback if table names differ)
  let contentPageIds: string[] = [];
  try {
    const rows = await prisma.$queryRaw<Array<{ pageId: string }>>`
      SELECT DISTINCT b."pageId"
      FROM "Block" b
      JOIN "Page" p ON p.id = b."pageId"
      WHERE p."workspaceId" = ANY(${workspaceIds})
        AND p."isArchived" = false
        AND CAST(b.content AS TEXT) ILIKE ${'%' + q + '%'}
      LIMIT 20
    `;
    contentPageIds = rows.map((r) => r.pageId);
  } catch {
    // Raw query failed (e.g. table name mismatch) — title results still returned below
  }

  // Fetch pages for content hits not already in title results
  const titleHitIds = new Set(titleHits.map((p) => p.id));
  const extraIds = contentPageIds.filter((id) => !titleHitIds.has(id));

  let contentHits: typeof titleHits = [];
  if (extraIds.length > 0) {
    contentHits = await prisma.page.findMany({
      where: { id: { in: extraIds }, isArchived: false },
      select: { id: true, title: true, icon: true, workspaceId: true, databaseId: true },
    });
  }

  const all = [...titleHits, ...contentHits].slice(0, 20);

  return NextResponse.json({
    results: all.map((p) => ({
      id: p.id,
      title: p.title || 'Untitled',
      icon: p.icon ?? '📄',
      workspaceName: workspaceMap[p.workspaceId] ?? '',
      databaseId: p.databaseId,
      matchType: titleHitIds.has(p.id) ? ('title' as const) : ('content' as const),
    })),
  });
}
