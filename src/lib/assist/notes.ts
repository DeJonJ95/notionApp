// Facts from the person's own workspace for the assistant to work from: pages
// matching a search, and the database row a to-do links to. Search mirrors
// app/api/search (tsvector on titles and block text, ILIKE fallback).

import { prisma } from '@/lib/prisma';

export type Note = { title: string; text: string };

const NOTE_CHARS = 1500;
const MAX_NOTES = 3;

type TipNode = { type?: string; text?: string; content?: TipNode[] };

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'tableRow', 'codeBlock']);

/** Plain text of a TipTap document, one line per block. */
export function docText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as TipNode;
  if (n.text) return n.text;
  const inner = (n.content ?? []).map(docText).join(n.type === 'tableRow' ? ' | ' : '');
  return BLOCK_TYPES.has(n.type ?? '') ? `${inner}\n` : inner;
}

async function pageText(pageId: string): Promise<string> {
  const blocks = await prisma.block.findMany({ where: { pageId }, orderBy: { position: 'asc' }, select: { content: true } });
  return blocks.map((b) => docText(b.content)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function matchingPages(workspaceIds: string[], q: string): Promise<{ id: string; title: string }[]> {
  try {
    return await prisma.$queryRaw<{ id: string; title: string }[]>`
      SELECT id, title FROM (
        SELECT p.id, p.title, ts_rank(p.search_vector, websearch_to_tsquery('english', ${q})) * 2 AS rank
        FROM "Page" p
        WHERE p."workspaceId" = ANY(${workspaceIds}) AND p."isArchived" = false
          AND p.search_vector @@ websearch_to_tsquery('english', ${q})
        UNION ALL
        SELECT p.id, p.title, ts_rank(b.search_vector, websearch_to_tsquery('english', ${q})) AS rank
        FROM "Block" b JOIN "Page" p ON p.id = b."pageId"
        WHERE p."workspaceId" = ANY(${workspaceIds}) AND p."isArchived" = false
          AND b.search_vector @@ websearch_to_tsquery('english', ${q})
      ) hits
      GROUP BY id, title
      ORDER BY MAX(rank) DESC
      LIMIT 6`;
  } catch {
    return prisma.page.findMany({
      where: { workspaceId: { in: workspaceIds }, isArchived: false, title: { contains: q, mode: 'insensitive' } },
      select: { id: true, title: true },
      take: 6,
    });
  }
}

/** Up to three pages that match `query`, skipping the journal page itself. */
export async function searchNotes(userId: string, query: string, skip: string[]): Promise<Note[]> {
  const q = query.trim();
  if (!q) return [];
  const workspaces = await prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } });
  const hits = (await matchingPages(workspaces.map((w) => w.id), q)).filter((h) => !skip.includes(h.id)).slice(0, MAX_NOTES);
  const notes = await Promise.all(hits.map(async (h) => ({ title: h.title || 'Untitled', text: (await pageText(h.id)).slice(0, NOTE_CHARS) })));
  return notes.filter((n) => n.text || n.title);
}

export type LinkedRow = { title: string; databaseId: string; databaseName: string; fields: string; text: string };

/** The database row a to-do links to, with its field values and body. */
export async function linkedRow(userId: string, rowId: string): Promise<LinkedRow | null> {
  const row = await prisma.page.findFirst({
    where: { id: rowId, workspace: { ownerId: userId } },
    select: {
      title: true, databaseId: true,
      database: { select: { name: true } },
      properties: { select: { value: true, property: { select: { name: true, type: true } } } },
    },
  });
  if (!row?.databaseId) return null;
  const fields = row.properties
    .filter((v) => v.property.type !== 'relation' && v.value !== null && v.value !== '')
    .map((v) => `${v.property.name}: ${String(v.value)}`)
    .join('; ');
  return { title: row.title, databaseId: row.databaseId, databaseName: row.database?.name ?? '', fields, text: (await pageText(rowId)).slice(0, NOTE_CHARS) };
}
