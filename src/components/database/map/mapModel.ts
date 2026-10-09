export type MapProp = { id: string; name: string; type: string; formula?: string | null };
export type MapValue = { property: { id: string }; value: unknown };
export type MapPage = { id: string; title: string; properties: MapValue[]; createdAt?: string | Date };
export type MapDb = { id: string; workspaceId: string; properties: MapProp[]; pages: MapPage[] };
export type Point = { x: number; y: number };
export type StatusKey = 'done' | 'active' | 'review' | 'ready' | 'waiting';

export type MapProps = {
  status?: MapProp;
  lane?: MapProp;
  waitsOn?: MapProp;
  next?: MapProp;
  tasks?: MapProp;
  taskDb?: MapProp;
  due?: MapProp;
  owner?: MapProp;
};

export type MapNode = {
  id: string;
  title: string;
  lane: string;
  laneValue: string;
  due: string;
  owner: string;
  rawStatus: string;
  status: StatusKey;
  label: string;
  color: string;
  deps: string[];
  next: string;
  subtitle: string;
  at: Point;
  laneOrigin: Point;
  pinned: boolean;
};

export type MapLane = { name: string; x: number; y: number; w: number; h: number; tint: string };
export type MapEdge = { from: string; to: string; d: string; settled: boolean };
export type MapTab = { name: string; done: number; total: number };
export type MapModel = { nodes: MapNode[]; all: MapNode[]; lanes: MapLane[]; edges: MapEdge[]; width: number; height: number; across: boolean };

export { NODE_W, NODE_H } from './mapLayout';
import { NODE_W, NODE_H, PAD, laneFrames, placeNodes } from './mapLayout';

export const STATUS_STYLE: Record<StatusKey, { label: string; color: string }> = {
  done: { label: 'Done', color: '#2f7d4f' },
  active: { label: 'In progress', color: '#1f6fc0' },
  review: { label: 'In review', color: '#7a4fc4' },
  ready: { label: 'Ready to start', color: '#c25e00' },
  waiting: { label: 'Waiting', color: '#787774' },
};

export function parseConfig(formula?: string | null): Record<string, unknown> {
  try {
    const j = JSON.parse(formula || '');
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

export function selectOptions(prop?: MapProp): string[] {
  if (!prop) return [];
  try {
    const j = JSON.parse(prop.formula || '[]');
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

function byName(props: MapProp[], pattern: RegExp): MapProp | undefined {
  return props.find((p) => pattern.test(p.name));
}

export function detectProps(db: MapDb): MapProps {
  const selects = db.properties.filter((p) => p.type === 'select');
  const relations = db.properties.filter((p) => p.type === 'relation');
  const selfRel = relations.filter((p) => parseConfig(p.formula).targetDatabaseId === db.id);
  const otherRel = relations.filter((p) => parseConfig(p.formula).targetDatabaseId !== db.id);
  const status = byName(selects, /status|stage|state/i) ?? selects[0];
  const rest = selects.filter((p) => p !== status);
  return {
    status,
    lane: byName(rest, /phase/i) ?? byName(rest, /area|lane|group|category|client|team/i),
    waitsOn: byName(selfRel, /wait|block|depend|after|needs/i) ?? selfRel[0],
    next: byName(db.properties.filter((p) => p.type === 'text'), /next/i),
    taskDb: byName(db.properties.filter((p) => p.type === 'text'), /task\s*(database|db)/i),
    due: byName(db.properties.filter((p) => p.type === 'date'), /due|deadline|date/i),
    owner: byName(db.properties.filter((p) => p.type === 'text'), /assignee|owner|who/i),
    tasks: byName(otherRel, /task/i),
  };
}

export function valueOf(page: MapPage, prop?: MapProp): unknown {
  if (!prop) return undefined;
  return page.properties.find((pv) => pv.property.id === prop.id)?.value;
}

export function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function isDoneLabel(s: string): boolean {
  return /^(done|complete|completed|shipped|finished|closed|archived)$/i.test(s.trim());
}

function baseStatus(raw: string): StatusKey | null {
  if (isDoneLabel(raw)) return 'done';
  if (/review/i.test(raw)) return 'review';
  if (/progress|active|doing|started|building/i.test(raw)) return 'active';
  return null;
}

export function edgePath(a: Point, b: Point): string {
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x - 4, y2 = b.y + NODE_H / 2;
  const c = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}

function resolveStatus(raw: string, deps: string[], rawById: Map<string, string>): { status: StatusKey; label: string } {
  if (/^archived$/i.test(raw.trim())) return { status: 'done', label: 'Archived' };
  const base = baseStatus(raw);
  if (base) return { status: base, label: STATUS_STYLE[base].label };
  const open = deps.filter((d) => !isDoneLabel(rawById.get(d) ?? '')).length;
  if (!open) return { status: 'ready', label: STATUS_STYLE.ready.label };
  return { status: 'waiting', label: `Waiting on ${open}` };
}

function subtitleOf(page: MapPage, props: MapProps): string {
  const next = String(valueOf(page, props.next) ?? '').trim();
  if (next) return next;
  const due = String(valueOf(page, props.due) ?? '').slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(due) ? `Due ${new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
  return [when, String(valueOf(page, props.owner) ?? '').trim()].filter(Boolean).join(' · ');
}

export function isArchived(page: MapPage, props: MapProps): boolean {
  return /^archived$/i.test(String(valueOf(page, props.status) ?? '').trim());
}

export type BuildOptions = { showArchived?: boolean; only?: string | null };

function visiblePages(all: MapDb, props: MapProps, showArchived?: boolean): MapDb {
  return showArchived ? all : { ...all, pages: all.pages.filter((p) => !isArchived(p, props)) };
}

export function laneTabs(all: MapDb, props: MapProps, showArchived?: boolean): MapTab[] {
  const { nodes } = makeNodes(visiblePages(all, props, showArchived), props);
  const opts = selectOptions(props.lane);
  const used = Array.from(new Set(nodes.map((n) => n.lane)));
  const order = [...opts.filter((o) => used.includes(o)), ...used.filter((l) => !opts.includes(l))];
  return order.map((name) => {
    const members = nodes.filter((n) => n.lane === name);
    return { name, done: members.filter((n) => n.status === 'done').length, total: members.length };
  });
}

// Auto-placement follows creation order, so a new card lands after the existing ones instead of taking the first slot.
function byCreation(pages: MapPage[]): MapPage[] {
  const t = (p: MapPage) => (p.createdAt ? new Date(p.createdAt).getTime() : 0);
  return [...pages].sort((a, b) => t(a) - t(b));
}

function makeNodes(db: MapDb, props: MapProps): { nodes: MapNode[]; rawById: Map<string, string> } {
  const ids = new Set(db.pages.map((p) => p.id));
  const rawById = new Map(db.pages.map((p) => [p.id, String(valueOf(p, props.status) ?? '')]));
  const noLane = `No ${(props.lane?.name ?? 'area').toLowerCase()}`;
  const nodes: MapNode[] = byCreation(db.pages).map((p) => {
    const deps = idList(valueOf(p, props.waitsOn)).filter((d) => ids.has(d) && d !== p.id);
    const raw = rawById.get(p.id) ?? '';
    const st = resolveStatus(raw, deps, rawById);
    const laneValue = String(valueOf(p, props.lane) ?? '');
    return {
      id: p.id, title: p.title || 'Untitled', lane: laneValue || noLane, laneValue, due: String(valueOf(p, props.due) ?? '').slice(0, 10), owner: String(valueOf(p, props.owner) ?? ''), rawStatus: raw, deps,
      status: st.status, label: st.label, color: STATUS_STYLE[st.status].color,
      next: String(valueOf(p, props.next) ?? ''), subtitle: subtitleOf(p, props), at: { x: 0, y: 0 }, laneOrigin: { x: 0, y: 0 }, pinned: false,
    };
  });
  return { nodes, rawById };
}

// `only` narrows the canvas to one lane (a phase tab); statuses and the tab counts still see every card.
export function buildModel(all: MapDb, props: MapProps, pinned: Record<string, Point>, opts: BuildOptions = {}): MapModel {
  const db = visiblePages(all, props, opts.showArchived);
  const { nodes: every, rawById } = makeNodes(db, props);
  const laneOpts = selectOptions(props.lane);
  const used = new Set(every.map((n) => n.lane));
  const laneOrder = [...laneOpts, ...Array.from(used).filter((l) => !laneOpts.includes(l))].filter((l) => used.has(l));
  const only = opts.only && used.has(opts.only) ? opts.only : null;
  const nodes = only ? every.filter((n) => n.lane === only) : every;
  const shown = only ? [only] : laneOrder;
  const across = Boolean(props.lane && /phase/i.test(props.lane.name));
  placeNodes(nodes, shown, pinned, across && !only);
  const at = new Map(nodes.map((n) => [n.id, n.at]));
  const edges = nodes.flatMap((n) => n.deps.filter((d) => at.has(d))
    .map((d) => ({ from: d, to: n.id, d: edgePath(at.get(d)!, n.at), settled: isDoneLabel(rawById.get(d) ?? '') })));
  const width = Math.max(800, ...nodes.map((n) => n.at.x + NODE_W)) + PAD;
  const height = Math.max(400, ...nodes.map((n) => n.at.y + NODE_H)) + PAD;
  return { nodes, all: every, lanes: shown.length > 1 ? laneFrames(nodes, shown, across) : [], edges, width, height, across: across && !only };
}

export function downstreamOf(id: string, nodes: MapNode[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (!out.has(n.id) && n.deps.some((d) => out.has(d))) { out.add(n.id); grew = true; }
    }
  }
  return out;
}
