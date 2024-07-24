import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logDeepSeek } from '@/lib/logUsage';

export type PropertyInfo = { id: string; type: string };

export type ResolvedUpdate = {
  action: 'update';
  database: string;
  databaseId: string;
  pageId: string;
  pageTitle: string;
  changes: Record<string, unknown>;
  propertyMap: Record<string, PropertyInfo>;
};

export type ResolvedCreate = {
  action: 'create';
  database: string;
  databaseId: string;
  workspaceId: string;
  row: Record<string, unknown>;
  propertyMap: Record<string, PropertyInfo>;
};

export type ResolvedChange = ResolvedUpdate | ResolvedCreate;

type AiChange = {
  action: 'update' | 'create';
  database: string;
  match?: Record<string, string>;
  changes?: Record<string, unknown>;
  row?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'DeepSeek API key not configured' }, { status: 500 });

  const { notes, databaseIds } = await req.json() as { notes: string; databaseIds: string[] };
  if (!notes?.trim()) return NextResponse.json({ error: 'Notes are required' }, { status: 400 });
  if (!Array.isArray(databaseIds) || databaseIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one database' }, { status: 400 });
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
  {"action":"update","database":"<name>","match":{"Name":"<row name>"},"changes":{"<col>":"<value>"}}
  {"action":"create","database":"<name>","row":{"Name":"<title>","<col>":"<value>"}}
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
      max_tokens: 1024,
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

  for (const change of proposed) {
    if (!change.action || !change.database) continue;

    const db = dbByName.get(change.database.toLowerCase());
    if (!db) continue;

    const propertyMap: Record<string, PropertyInfo> = {};
    for (const p of db.properties) {
      propertyMap[p.name] = { id: p.id, type: p.type };
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
      });
    } else if (change.action === 'create' && change.row) {
      resolved.push({
        action: 'create',
        database: db.name,
        databaseId: db.id,
        workspaceId: db.workspaceId,
        row: change.row,
        propertyMap,
      });
    }
  }

  return NextResponse.json({ changes: resolved });
}
