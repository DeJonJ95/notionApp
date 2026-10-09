export type MapProp = { id: string; name: string; type: string; formula?: string | null };
export type MapValue = { property: { id: string }; value: unknown };
export type MapPage = { id: string; title: string; properties: MapValue[] };
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
  rawStatus: string;
  status: StatusKey;
  label: string;
  color: string;
  deps: string[];
  next: string;
  subtitle: string;
  at: Point;
  laneTop: number;
  pinned: boolean;
};

export type MapLane = { name: string; x: number; y: number; w: number; h: number; tint: string };
export type MapEdge = { from: string; to: string; d: string; settled: boolean };
export type MapModel = { nodes: MapNode[]; lanes: MapLane[]; edges: MapEdge[]; width: number; height: number };

export const NODE_W = 232;
export const NODE_H = 116;
const COL = 296;
const ROW = 140;
const PAD = 48;
const HEAD = 48;
const LANE_GAP = 36;
const NO_LANE = 'No area';

export const STATUS_STYLE: Record<StatusKey, { label: string; color: string }> = {
  done: { label: 'Done', color: '#2f7d4f' },
  active: { label: 'In progress', color: '#1f6fc0' },
  review: { label: 'In review', color: '#7a4fc4' },
  ready: { label: 'Ready to start', color: '#c25e00' },
  waiting: { label: 'Waiting', color: '#787774' },
};

const LANE_TINTS = ['35,131,226', '194,94,0', '47,125,79', '122,79,196', '180,60,110', '90,90,90'];

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
    lane: byName(rest, /area|lane|group|category|client|team/i),
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

function depthOf(id: string, deps: Map<string, string[]>, memo: Map<string, number>, seen = new Set<string>()): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  if (seen.has(id)) return 0;
  seen.add(id);
  const ups = deps.get(id) ?? [];
  const d = ups.length ? 1 + Math.max(...ups.map((u) => depthOf(u, deps, memo, seen))) : 0;
  memo.set(id, d);
  return d;
}

const MAX_ROWS = 3;

// Each dependency depth gets enough sub-columns that no lane stacks more than MAX_ROWS deep; offsets are shared by all lanes so arrows still run left to right.
function columnStarts(nodes: MapNode[], depth: Map<string, number>): number[] {
  const counts = new Map<string, number>();
  for (const n of nodes) { const k = `${n.lane}|${depth.get(n.id)}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const sub = Array.from({ length: maxDepth + 1 }, () => 1);
  for (const [k, c] of Array.from(counts)) { const d = Number(k.split('|')[1]); sub[d] = Math.max(sub[d], Math.ceil(c / MAX_ROWS)); }
  return sub.map((_, d) => sub.slice(0, d).reduce((a, b) => a + b, 0));
}

// Within a wrapped column, projects that feed others go in the right-most sub-column so their arrows never pass behind a card.
function feedersLast(list: MapNode[], feeders: Set<string>): MapNode[] {
  return [...list.filter((n) => !feeders.has(n.id)), ...list.filter((n) => feeders.has(n.id))];
}

// Pinned positions are stored relative to their lane's top, so a lane that grows pushes the lanes below it down.
function placeNodes(nodes: MapNode[], laneOrder: string[], pinned: Record<string, Point>): void {
  const deps = new Map(nodes.map((n) => [n.id, n.deps]));
  const memo = new Map<string, number>();
  const depth = new Map(nodes.map((n) => [n.id, depthOf(n.id, deps, memo)]));
  const start = columnStarts(nodes, depth);
  const feeders = new Set(nodes.flatMap((n) => n.deps));
  let top = PAD;
  for (const lane of laneOrder) {
    const seen = new Map<number, number>();
    let bottom = top;
    for (const n of feedersLast(nodes.filter((m) => m.lane === lane), feeders)) {
      const d = depth.get(n.id) ?? 0;
      const i = seen.get(d) ?? 0;
      seen.set(d, i + 1);
      const p = pinned[n.id];
      const col = start[d] + Math.floor(i / MAX_ROWS);
      n.pinned = Boolean(p);
      n.laneTop = top;
      n.at = p ? { x: Math.max(8, p.x), y: top + Math.max(HEAD, p.y) } : { x: PAD + 24 + col * COL, y: top + HEAD + (i % MAX_ROWS) * ROW };
      bottom = Math.max(bottom, n.at.y + NODE_H);
    }
    top = bottom + 24 + LANE_GAP;
  }
}

export function edgePath(a: Point, b: Point): string {
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x - 4, y2 = b.y + NODE_H / 2;
  const c = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}

function laneFrames(nodes: MapNode[], laneOrder: string[]): MapLane[] {
  return laneOrder.map((name, i) => {
    const members = nodes.filter((n) => n.lane === name);
    const xs = members.map((n) => n.at.x), ys = members.map((n) => n.at.y);
    const x = Math.min(...xs) - 24, y = members[0].laneTop;
    const w = Math.max(...xs) + NODE_W + 24 - x, h = Math.max(...ys) + NODE_H + 24 - y;
    return { name, x, y, w, h, tint: LANE_TINTS[i % LANE_TINTS.length] };
  });
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

export function buildModel(all: MapDb, props: MapProps, pinned: Record<string, Point>, showArchived = false): MapModel {
  const db = showArchived ? all : { ...all, pages: all.pages.filter((p) => !isArchived(p, props)) };
  const ids = new Set(db.pages.map((p) => p.id));
  const rawById = new Map(db.pages.map((p) => [p.id, String(valueOf(p, props.status) ?? '')]));
  const laneOpts = selectOptions(props.lane);
  const nodes: MapNode[] = db.pages.map((p) => {
    const deps = idList(valueOf(p, props.waitsOn)).filter((d) => ids.has(d) && d !== p.id);
    const raw = rawById.get(p.id) ?? '';
    const st = resolveStatus(raw, deps, rawById);
    const lane = String(valueOf(p, props.lane) ?? '') || NO_LANE;
    return {
      id: p.id, title: p.title || 'Untitled', lane, rawStatus: raw, deps,
      status: st.status, label: st.label, color: STATUS_STYLE[st.status].color,
      next: String(valueOf(p, props.next) ?? ''), subtitle: subtitleOf(p, props), at: { x: 0, y: 0 }, laneTop: 0, pinned: false,
    };
  });
  const used = new Set(nodes.map((n) => n.lane));
  const laneOrder = [...laneOpts, ...Array.from(used).filter((l) => !laneOpts.includes(l))].filter((l) => used.has(l));
  placeNodes(nodes, laneOrder, pinned);
  const at = new Map(nodes.map((n) => [n.id, n.at]));
  const edges = nodes.flatMap((n) =>
    n.deps.map((d) => ({ from: d, to: n.id, d: edgePath(at.get(d)!, n.at), settled: isDoneLabel(rawById.get(d) ?? '') })),
  );
  const width = Math.max(800, ...nodes.map((n) => n.at.x + NODE_W)) + PAD;
  const height = Math.max(400, ...nodes.map((n) => n.at.y + NODE_H)) + PAD;
  return { nodes, lanes: laneOrder.length > 1 ? laneFrames(nodes, laneOrder) : [], edges, width, height };
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
