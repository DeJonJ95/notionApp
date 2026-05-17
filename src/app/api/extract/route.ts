import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';

export type PropertyInfo = { id: string; type: string };

// A column the extraction wants but the database doesn't have yet. Surfaced
// in the preview so the user can approve creating it (or skip it).
export type ProposedColumn = { name: string; type: string };

export type ResolvedUpdate = {
  action: 'update';
  database: string;
  databaseId: string;
  pageId: string;
  pageTitle: string;
  changes: Record<string, unknown>;
  propertyMap: Record<string, PropertyInfo>;
  proposedColumns?: ProposedColumn[];
};

export type ResolvedCreate = {
  action: 'create';
  database: string;
  databaseId: string;
  workspaceId: string;
  row: Record<string, unknown>;
  body?: string; // optional descriptive paragraph for the new page body
  propertyMap: Record<string, PropertyInfo>;
  proposedColumns?: ProposedColumn[];
};

export type ResolvedChange = ResolvedUpdate | ResolvedCreate;

type AiChange = {
  action: 'update' | 'create';
  database: string;
  match?: Record<string, string>;
  changes?: Record<string, unknown>;
  row?: Record<string, unknown>;
  body?: string;
  newColumns?: { name: string; type?: string }[];
};

// Walk a TipTap-style JSON tree (or any nested object) and concatenate all
// `text` leaves, with newlines for paragraph-ish boundaries.
function extractTextFromBlockJson(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractTextFromBlockJson).join(' ');
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return node.text;
    const inner = node.content ? extractTextFromBlockJson(node.content) : '';
    // Add a paragraph break after block-level nodes
    const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock']);
    return blockTypes.has(node.type) ? `${inner}\n` : inner;
  }
  return '';
}

async function loadPagesAsText(pageIds: string[], userId: string): Promise<{ title: string; text: string }[]> {
  if (pageIds.length === 0) return [];
  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds }, workspace: { ownerId: userId }, isArchived: false },
    include: { blocks: { orderBy: { position: 'asc' }, take: 200 } },
  });
  return pages.map((p) => ({
    title: p.title,
    text: p.blocks
      .map((b) => extractTextFromBlockJson(b.content))
      .filter((t) => t.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const {
    notes: rawNotes,
    databaseIds,
    pageIds,
  } = (await req.json()) as {
    notes?: string;
    databaseIds: string[];
    pageIds?: string[];
  };

  if (!Array.isArray(databaseIds) || databaseIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one database' }, { status: 400 });
  }

  // Compose the source text: combine pasted notes + page bodies (if any)
  const loadedPages = await loadPagesAsText(pageIds ?? [], userId);
  const sections: string[] = [];
  if (rawNotes?.trim()) sections.push(rawNotes.trim());
  for (const p of loadedPages) {
    if (!p.text) continue;
    sections.push(`=== Page: ${p.title} ===\n${p.text}`);
  }
  const notes = sections.join('\n\n');
  if (!notes.trim()) {
    return NextResponse.json({ error: 'No source content (paste notes or pick a page)' }, { status: 400 });
  }

  // Fetch databases with properties and rows (owned by user)
  const databases = await prisma.database.findMany({
    where: {
      id: { in: databaseIds },
      workspace: { ownerId: userId },
    },
    include: {
      workspace: { select: { id: true } },
      properties: { orderBy: { position: 'asc' } },
      pages: {
        where: { isArchived: false },
        orderBy: { position: 'asc' },
        take: 50,
        select: {
          id: true,
          title: true,
          properties: {
            select: { property: { select: { name: true } }, value: true },
          },
        },
      },
    },
  });

  if (databases.length === 0) {
    return NextResponse.json({ error: 'No accessible databases found' }, { status: 404 });
  }

  // Build context for the AI
  const dbContext = databases.map((db) => {
    const cols = ['Name', ...db.properties.map((p) => `${p.name} (${p.type})`)].join(', ');
    const rows = db.pages.slice(0, 30).map((page) => {
      const vals = db.properties.map((prop) => {
        const pv = page.properties.find((v) => v.property.name === prop.name);
        const raw = pv?.value;
        return `${prop.name}: ${raw == null ? '—' : JSON.stringify(raw)}`;
      });
      return `  - Name: "${page.title}"${vals.length ? ', ' + vals.join(', ') : ''}`;
    });
    return `Database: "${db.name}"\nColumns: ${cols}\nRows:\n${rows.length ? rows.join('\n') : '  (empty)'}`;
  }).join('\n\n');

  const systemPrompt = `You are a data extraction assistant. Analyze meeting notes and return ONLY a valid JSON array of database operations. No prose, no markdown fences, no keys outside the array.

${dbContext}

Rules:
- Match to existing rows by "Name" when confident. Use the exact name from the rows list or a close variation.
- Create new rows when no match exists.
- Never delete rows.
- Return [] if nothing relevant.
- Each element must be one of:
  {"action":"update","database":"<name>","match":{"Name":"<row name>"},"changes":{"<col>":"<value>"},"newColumns":[{"name":"<col>","type":"text|number|date|select|checkbox"}],"body":"<optional>"}
  {"action":"create","database":"<name>","row":{"Name":"<title>","<col>":"<value>"},"newColumns":[...],"body":"<optional 1-3 sentence summary of what the notes said about this item — context the property columns can't capture>"}
- "body" is OPTIONAL. Include it on create when the notes give meaningful narrative context that should live on the new page. Keep it factual and short.

ACTION ITEMS — when the notes contain a task / to-do / commitment / follow-up, capture it richly, not just a title:
- Put WHO is responsible into an owner/assignee column if one exists; otherwise propose one.
- Put any deadline into a date column (ISO YYYY-MM-DD); resolve relative dates ("next Friday") against today = ${new Date().toISOString().slice(0, 10)}.
- Put status/priority into matching columns if present (e.g. "Not Started", "High").
- Always include a "body" giving the full context of the action item: what exactly needs to happen, why, any dependencies or constraints mentioned — a few sentences, not a fragment.

NEW COLUMNS — "newColumns" is OPTIONAL. If the notes contain a meaningful attribute that NO existing column captures (e.g. an owner, a due date, an amount, a status), you MAY propose a new column: add it to "newColumns" with a sensible type AND put the value in changes/row under that column name. Only propose columns that add real structured value — prefer existing columns; never propose a column just to restate the title or body.
- Values must match the column type: numbers for number columns, strings for text/select, ISO dates for date columns, true/false for checkbox.`;

  const userPrompt = `Meeting notes:\n"""\n${notes.trim()}\n"""`;

  // Call DeepSeek
  const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error('DeepSeek error:', err);
    return NextResponse.json({ error: 'AI extraction failed' }, { status: 502 });
  }

  const aiJson = await aiRes.json();
  if (aiJson.usage) logDeepSeek('extract', aiJson.usage, userId);
  const raw = aiJson.choices?.[0]?.message?.content ?? '[]';

  let proposed: AiChange[];
  try {
    // Strip markdown fences if the model includes them despite instructions
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    proposed = JSON.parse(cleaned);
    if (!Array.isArray(proposed)) proposed = [];
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON', raw }, { status: 502 });
  }

  // Build lookup maps
  const dbByName = new Map(databases.map((db) => [db.name.toLowerCase(), db]));

  const resolved: ResolvedChange[] = [];

  const inferType = (v: unknown): string => {
    if (typeof v === 'boolean') return 'checkbox';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
    return 'text';
  };

  for (const change of proposed) {
    if (!change.action || !change.database) continue;

    const db = dbByName.get(change.database.toLowerCase());
    if (!db) continue;

    const propertyMap: Record<string, PropertyInfo> = {};
    for (const p of db.properties) {
      propertyMap[p.name] = { id: p.id, type: p.type };
    }

    // Detect columns referenced by this change that don't exist yet →
    // surface them as proposals for the user to approve.
    const dataObj = (change.action === 'update' ? change.changes : change.row) ?? {};
    const aiCols = new Map(
      (change.newColumns ?? []).map((c) => [c.name, c.type])
    );
    const proposedColumns: ProposedColumn[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(dataObj)) {
      if (key === 'Name' || propertyMap[key] || seen.has(key)) continue;
      const type = aiCols.get(key) ?? inferType((dataObj as any)[key]);
      const validType = ['text', 'number', 'date', 'select', 'checkbox'].includes(type) ? type : 'text';
      proposedColumns.push({ name: key, type: validType });
      seen.add(key);
    }

    if (change.action === 'update' && change.match && change.changes) {
      const matchName = change.match['Name'] ?? Object.values(change.match)[0];
      if (!matchName) continue;

      // Find best-matching page (exact first, then case-insensitive)
      let page = db.pages.find((p) => p.title === matchName);
      if (!page) {
        page = db.pages.find(
          (p) => p.title.toLowerCase() === matchName.toLowerCase()
        );
      }
      if (!page) continue;

      resolved.push({
        action: 'update',
        database: db.name,
        databaseId: db.id,
        pageId: page.id,
        pageTitle: page.title,
        changes: change.changes,
        propertyMap,
        proposedColumns: proposedColumns.length ? proposedColumns : undefined,
      });
    } else if (change.action === 'create' && change.row) {
      resolved.push({
        action: 'create',
        database: db.name,
        databaseId: db.id,
        workspaceId: db.workspaceId,
        row: change.row,
        body: typeof change.body === 'string' && change.body.trim() ? change.body.trim() : undefined,
        propertyMap,
        proposedColumns: proposedColumns.length ? proposedColumns : undefined,
      });
    }
  }

  return NextResponse.json({ changes: resolved });
}
