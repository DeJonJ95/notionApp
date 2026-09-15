import { prisma } from './prisma';

export type AgendaBucket = 'overdue' | 'today' | 'inProgress';

export type AgendaItem = {
  id: string;
  title: string;
  icon: string | null;
  databaseId: string;
  databaseName: string;
  dueDate: string | null;
  status: string | null;
  bucket: AgendaBucket;
};

export type AgendaTarget = {
  id: string;
  name: string;
  workspaceName: string;
  hasDue: boolean;
  hasStatus: boolean;
};

export type Agenda = { items: AgendaItem[]; databases: AgendaTarget[] };

export type Prop = { id: string; name: string; type: string; formula: string | null };

const DONE_RE = /^(done|complete|completed|finished|closed|cancel|cancelled|archived)$/i;
const IN_PROGRESS_RE = /progress|doing|active|started|working|review/i;
const NEGATED_RE = /^(not|never)\b/i;
const MAX_ITEMS = 60;

export function isDoneStatus(value: string | null): boolean {
  return value != null && DONE_RE.test(value.trim());
}

// "Not Started" must not read as started.
export function isInProgressStatus(value: string | null): boolean {
  if (!value) return false;
  const v = value.trim();
  return !NEGATED_RE.test(v) && IN_PROGRESS_RE.test(v);
}

export function selectOptions(prop: Prop | undefined): string[] {
  if (!prop?.formula) return [];
  try {
    const parsed: unknown = JSON.parse(prop.formula);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function dueProperty(props: Prop[]): Prop | undefined {
  const dates = props.filter((p) => p.type === 'date');
  return dates.find((p) => /due|deadline/i.test(p.name)) ?? dates[0];
}

export function statusProperty(props: Prop[]): Prop | undefined {
  const selects = props.filter((p) => p.type === 'select');
  return selects.find((p) => /status|stage|state/i.test(p.name));
}

// Mirrors the schema signature findOrCreateBudgetDb uses. Budget rows are
// dated, so without this every transaction would land on the agenda.
function looksLikeBudget(props: Prop[]): boolean {
  const has = (name: string, type?: string) =>
    props.some((p) => p.name === name && (!type || p.type === type));
  return has('Amount', 'number') && has('Date', 'date') && has('Category') && has('Vendor');
}

function asText(value: unknown): string | null {
  if (value == null || value === '') return null;
  return typeof value === 'string' ? value : String(value);
}

export type RowInput = {
  id: string;
  title: string;
  icon: string | null;
  properties: { propertyId: string; value: unknown }[];
};

export function classifyRow(row: RowInput, due: Prop | undefined, status: Prop | undefined, today: string) {
  const cell = (p: Prop | undefined) =>
    p ? asText(row.properties.find((v) => v.propertyId === p.id)?.value) : null;
  const dueDate = cell(due)?.slice(0, 10) ?? null;
  const statusValue = cell(status);
  if (isDoneStatus(statusValue)) return null;
  let bucket: AgendaBucket | null = null;
  if (dueDate && dueDate < today) bucket = 'overdue';
  else if (dueDate === today) bucket = 'today';
  else if (isInProgressStatus(statusValue)) bucket = 'inProgress';
  return bucket ? { dueDate, status: statusValue, bucket } : null;
}

const BUCKET_ORDER: Record<AgendaBucket, number> = { overdue: 0, today: 1, inProgress: 2 };

export async function buildAgenda(userId: string, today: string): Promise<Agenda> {
  const databases = await prisma.database.findMany({
    where: { workspace: { ownerId: userId } },
    orderBy: { createdAt: 'asc' },
    include: {
      workspace: { select: { name: true } },
      properties: { select: { id: true, name: true, type: true, formula: true } },
      pages: {
        where: { isArchived: false },
        select: { id: true, title: true, icon: true, properties: { select: { propertyId: true, value: true } } },
      },
    },
  });

  const items: AgendaItem[] = [];
  const targets: AgendaTarget[] = [];
  for (const db of databases) {
    if (looksLikeBudget(db.properties)) continue;
    const due = dueProperty(db.properties);
    const status = statusProperty(db.properties);
    targets.push({ id: db.id, name: db.name, workspaceName: db.workspace.name, hasDue: !!due, hasStatus: !!status });
    for (const row of db.pages) {
      const c = classifyRow(row, due, status, today);
      if (c) items.push({ id: row.id, title: row.title, icon: row.icon, databaseId: db.id, databaseName: db.name, ...c });
    }
  }

  items.sort(
    (a, b) =>
      BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.title.localeCompare(b.title)
  );
  return { items: items.slice(0, MAX_ITEMS), databases: targets };
}
