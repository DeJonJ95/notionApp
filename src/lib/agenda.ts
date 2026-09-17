import { prisma } from './prisma';

export type AgendaBucket = 'overdue' | 'today' | 'week' | 'inProgress';

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
  statusOptions: string[];
};

export type Agenda = { items: AgendaItem[]; databases: AgendaTarget[] };

export type Prop = { id: string; name: string; type: string; formula: string | null };

// The three columns the bridge reads and writes, discovered by name.
export type TaskSchema = { due?: Prop; status?: Prop; done?: Prop };

const DONE_RE = /^(done|complete|completed|finished|closed|cancel|cancelled|archived|cleared|paid)$/i;
const IN_PROGRESS_RE = /\b(in[\s-]?progress|progress|doing|active|started|working|in[\s-]?review|review)\b/i;
const NEGATED_RE = /^(not|never)\b/i;
const MAX_ITEMS = 60;
const WEEK_DAYS = 7;

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isDoneStatus(value: string | null): boolean {
  return value != null && DONE_RE.test(value.trim());
}

// "Not Started" must not read as started; "Inactive" must not read as active.
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

// Only an explicitly named deadline counts. Falling back to any date column
// turned "Last Completed" and "Last Contacted" into overdue deadlines.
export function dueProperty(props: Prop[]): Prop | undefined {
  return props.find((p) => p.type === 'date' && /due|deadline/i.test(p.name));
}

export function statusProperty(props: Prop[]): Prop | undefined {
  return props.find((p) => p.type === 'select' && /status|stage|state/i.test(p.name));
}

export function doneProperty(props: Prop[]): Prop | undefined {
  return props.find((p) => p.type === 'checkbox' && /done|complete/i.test(p.name));
}

export function taskSchema(props: Prop[]): TaskSchema {
  return { due: dueProperty(props), status: statusProperty(props), done: doneProperty(props) };
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

export function classifyRow(row: RowInput, schema: TaskSchema, today: string) {
  const cell = (p: Prop | undefined) => (p ? row.properties.find((v) => v.propertyId === p.id)?.value : undefined);
  const dueDate = asText(cell(schema.due))?.slice(0, 10) ?? null;
  const statusValue = asText(cell(schema.status));
  if (isDoneStatus(statusValue) || cell(schema.done) === true) return null;
  let bucket: AgendaBucket | null = null;
  if (dueDate && dueDate < today) bucket = 'overdue';
  else if (dueDate === today) bucket = 'today';
  else if (dueDate && dueDate <= addDays(today, WEEK_DAYS)) bucket = 'week';
  else if (isInProgressStatus(statusValue)) bucket = 'inProgress';
  return bucket ? { dueDate, status: statusValue, bucket } : null;
}

export type TaskWrite = { propertyId: string; value: string | boolean };
export type TaskWriteError = { error: string; code: 400 | 409 };

// A task PATCH either names a status option outright or asks for done/reopened,
// which maps onto the first matching status option or the Done checkbox.
export function resolveTaskWrite(body: { done?: unknown; status?: unknown }, schema: TaskSchema): TaskWrite | TaskWriteError {
  const { status, done } = schema;
  const options = selectOptions(status);
  if (typeof body.status === 'string') {
    if (!status) return { error: 'This database has no Status column', code: 409 };
    if (!options.includes(body.status)) return { error: 'Unknown status option', code: 400 };
    return { propertyId: status.id, value: body.status };
  }
  if (typeof body.done !== 'boolean') return { error: 'Expected { done: boolean } or { status: string }', code: 400 };
  const target = body.done ? options.find(isDoneStatus) : options.find((o) => !isDoneStatus(o));
  if (status && target) return { propertyId: status.id, value: target };
  if (done) return { propertyId: done.id, value: body.done };
  return { error: 'This database has no Complete/Done status option or Done checkbox', code: 409 };
}

const BUCKET_ORDER: Record<AgendaBucket, number> = { overdue: 0, today: 1, week: 2, inProgress: 3 };

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
    const schema = taskSchema(db.properties);
    targets.push({ id: db.id, name: db.name, workspaceName: db.workspace.name, hasDue: !!schema.due, hasStatus: !!schema.status, statusOptions: selectOptions(schema.status) });
    for (const row of db.pages) {
      const c = classifyRow(row, schema, today);
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
