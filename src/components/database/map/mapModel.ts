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
  at: Point;
  pinned: boolean;
};

export type MapLane = { name: string; x: number; y: number; w: number; h: number; tint: string };
export type MapEdge = { from: string; to: string; d: string; settled: boolean };
export type MapModel = { nodes: MapNode[]; lanes: MapLane[]; edges: MapEdge[]; width: number; height: number };

export const NODE_W = 232;
export const NODE_H = 104;
const COL = 296;
const ROW = 128;
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
  return /^(done|complete|completed|shipped|finished|closed)$/i.test(s.trim());
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

function autoPlace(nodes: MapNode[], laneOrder: string[]): Map<string, Point> {
  const deps = new Map(nodes.map((n) => [n.id, n.deps]));
  const memo = new Map<string, number>();
  const place = new Map<string, Point>();
  let top = PAD;
  for (const lane of laneOrder) {
    const rows = new Map<number, number>();
    let maxRows = 1;
    for (const n of nodes.filter((m) => m.lane === lane)) {
      const d = depthOf(n.id, deps, memo);
      const r = rows.get(d) ?? 0;
      rows.set(d, r + 1);
      maxRows = Math.max(maxRows, r + 1);
      place.set(n.id, { x: PAD + 24 + d * COL, y: top + HEAD + r * ROW });
    }
    top += HEAD + maxRows * ROW + LANE_GAP;
  }
  return place;
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
    const x = Math.min(...xs) - 24, y = Math.min(...ys) - HEAD;
    const w = Math.max(...xs) + NODE_W + 24 - x, h = Math.max(...ys) + NODE_H + 24 - y;
    return { name, x, y, w, h, tint: LANE_TINTS[i % LANE_TINTS.length] };
  });
}

function resolveStatus(raw: string, deps: string[], rawById: Map<string, string>): { status: StatusKey; label: string } {
  const base = baseStatus(raw);
  if (base) return { status: base, label: STATUS_STYLE[base].label };
  const open = deps.filter((d) => !isDoneLabel(rawById.get(d) ?? '')).length;
  if (!open) return { status: 'ready', label: STATUS_STYLE.ready.label };
  return { status: 'waiting', label: `Waiting on ${open}` };
}

export function buildModel(db: MapDb, props: MapProps, pinned: Record<string, Point>): MapModel {
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
      next: String(valueOf(p, props.next) ?? ''), at: { x: 0, y: 0 }, pinned: false,
    };
  });
  const used = new Set(nodes.map((n) => n.lane));
  const laneOrder = [...laneOpts, ...Array.from(used).filter((l) => !laneOpts.includes(l))].filter((l) => used.has(l));
  const auto = autoPlace(nodes, laneOrder);
  for (const n of nodes) {
    n.pinned = Boolean(pinned[n.id]);
    n.at = pinned[n.id] ?? auto.get(n.id) ?? { x: PAD, y: PAD };
  }
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
