export type CleanupReason = 'trashed' | 'empty' | 'untitled' | 'test' | 'stale';

export type NoteRow = {
  id: string;
  title: string;
  workspace: string;
  updatedAt: Date;
  isArchived: boolean;
  isJournal: boolean;
  blocks: number;
  children: number;
};

export type DbRow = { id: string; name: string; workspace: string; rows: number; lastEdited: Date | null };

export type Candidate = {
  kind: 'page' | 'database';
  id: string;
  title: string;
  workspace: string;
  updatedAt: string;
  reasons: CleanupReason[];
  detail: string;
};

export const STALE_DAYS = 180;
const DAY = 86_400_000;
const TEST_TITLE = /\b(test|testing|delete me|scratch|asdf|tmp|temp|copy of)\b/i;
const UNTITLED = /^\s*(untitled( project)?)?\s*$/i;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function noteReasons(n: NoteRow, now: Date): CleanupReason[] {
  if (n.isArchived) return ['trashed'];
  const out: CleanupReason[] = [];
  if (n.blocks === 0 && n.children === 0) out.push('empty');
  if (UNTITLED.test(n.title)) out.push('untitled');
  if (TEST_TITLE.test(n.title)) out.push('test');
  if (!n.isJournal && now.getTime() - n.updatedAt.getTime() > STALE_DAYS * DAY) out.push('stale');
  return out;
}

export function dbReasons(d: DbRow, now: Date): CleanupReason[] {
  const out: CleanupReason[] = [];
  if (d.rows === 0) out.push('empty');
  if (TEST_TITLE.test(d.name)) out.push('test');
  if (d.lastEdited && now.getTime() - d.lastEdited.getTime() > STALE_DAYS * DAY) out.push('stale');
  return out;
}

export function collectCandidates(notes: NoteRow[], dbs: DbRow[], now = new Date()): Candidate[] {
  const pages: Candidate[] = notes.flatMap((n) => {
    const reasons = noteReasons(n, now);
    if (!reasons.length) return [];
    const detail = n.children ? `${plural(n.blocks, 'block')}, ${plural(n.children, 'subpage')}` : plural(n.blocks, 'block');
    return [{ kind: 'page' as const, id: n.id, title: n.title || 'Untitled', workspace: n.workspace, updatedAt: n.updatedAt.toISOString(), reasons, detail }];
  });
  const databases: Candidate[] = dbs.flatMap((d) => {
    const reasons = dbReasons(d, now);
    if (!reasons.length) return [];
    return [{
      kind: 'database' as const, id: d.id, title: d.name, workspace: d.workspace,
      updatedAt: (d.lastEdited ?? now).toISOString(), reasons, detail: plural(d.rows, 'row'),
    }];
  });
  return [...databases, ...pages].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
