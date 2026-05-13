import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type PageRow = {
  id: string;
  title: string;
  icon: string | null;
  workspaceId: string;
  databaseId: string | null;
  rank: number;
};

type BlockPageRow = Omit<PageRow, 'rank'>;

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

  // No query — return recently updated pages for quick navigation
  if (!q) {
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

  // ── Title search via stored tsvector ──────────────────────────────────────
  // Uses the GIN index on "Page".search_vector for O(log n) lookups.
  // websearch_to_tsquery supports phrase search ("exact phrase"), negation
  // (-word), and OR — the same syntax as a Google search box.
  let titleHits: PageRow[] = [];
  try {
    titleHits = await prisma.$queryRaw<PageRow[]>`
      SELECT
        id,
        title,
        icon,
        "workspaceId",
        "databaseId",
        ts_rank(search_vector, websearch_to_tsquery('english', ${q})) AS rank
      FROM "Page"
      WHERE "workspaceId" = ANY(${workspaceIds})
        AND "isArchived" = false
        AND search_vector @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT 15
    `;
  } catch {
    // search_vector column not yet created — fall back to ILIKE on title
    const fallback = await prisma.page.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        isArchived: false,
        title: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, title: true, icon: true, workspaceId: true, databaseId: true },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });
    titleHits = fallback.map((p) => ({ ...p, rank: 0 }));
  }

  // ── Block content search via stored tsvector ──────────────────────────────
  // Finds pages whose body text contains the query.  Deduplicates with
  // DISTINCT ON so each page appears at most once.
  let contentHits: BlockPageRow[] = [];
  try {
    contentHits = await prisma.$queryRaw<BlockPageRow[]>`
      SELECT DISTINCT ON (p.id)
        p.id,
        p.title,
        p.icon,
        p."workspaceId",
        p."databaseId"
      FROM "Block" b
      JOIN "Page" p ON p.id = b."pageId"
      WHERE p."workspaceId" = ANY(${workspaceIds})
        AND p."isArchived" = false
        AND b.search_vector @@ websearch_to_tsquery('english', ${q})
      ORDER BY p.id
      LIMIT 10
    `;
  } catch {
    // Block search_vector not yet created — skip content search silently
  }

  // Merge: title hits first (ranked), then content-only hits
  const titleIds = new Set(titleHits.map((r) => r.id));
  const extras = contentHits.filter((r) => !titleIds.has(r.id));

  const results = [
    ...titleHits.map((r) => ({ ...r, matchType: 'title' as const })),
    ...extras.map((r) => ({ ...r, rank: 0, matchType: 'content' as const })),
  ]
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      title: r.title || 'Untitled',
      icon: r.icon ?? '📄',
      workspaceName: workspaceMap[r.workspaceId] ?? '',
      databaseId: r.databaseId,
      matchType: r.matchType,
    }));

  return NextResponse.json({ results });
}
