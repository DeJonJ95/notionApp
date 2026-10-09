import type { MapLane, MapNode, Point } from './mapModel';

export const NODE_W = 232;
export const NODE_H = 116;
export const PAD = 48;
const COL = 296;
const ROW = 140;
const HEAD = 48;
const LANE_GAP = 36;
const STACK_ROWS = 3;
const ROW_LANE_ROWS = 4;
const LANE_TINTS = ['35,131,226', '194,94,0', '47,125,79', '122,79,196', '180,60,110', '90,90,90'];

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

// Each depth gets enough sub-columns that no column stacks more than `rows` deep.
function columnStarts(nodes: MapNode[], depth: Map<string, number>, rows: number): number[] {
  const counts = new Map<string, number>();
  for (const n of nodes) { const k = `${n.lane}|${depth.get(n.id)}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const sub = Array.from({ length: maxDepth + 1 }, () => 1);
  for (const [k, c] of Array.from(counts)) { const d = Number(k.split('|')[1]); sub[d] = Math.max(sub[d], Math.ceil(c / rows)); }
  return sub.map((_, d) => sub.slice(0, d).reduce((a, b) => a + b, 0));
}


const clash = (a: Point, b: Point) => Math.abs(a.x - b.x) < NODE_W + 16 && Math.abs(a.y - b.y) < NODE_H + 16;

// The first slot at or after `from` that no hand-placed card already covers.
function freeSlot(slotAt: (i: number) => Point, from: number, taken: Point[]): number {
  let i = from;
  while (taken.some((t) => clash(t, slotAt(i))) && i < from + 200) i += 1;
  return i;
}

function depths(nodes: MapNode[], sameLaneOnly: boolean): Map<string, number> {
  const laneOf = new Map(nodes.map((n) => [n.id, n.lane]));
  const deps = new Map(nodes.map((n) => [n.id, sameLaneOnly ? n.deps.filter((d) => laneOf.get(d) === n.lane) : n.deps]));
  const memo = new Map<string, number>();
  return new Map(nodes.map((n) => [n.id, depthOf(n.id, deps, memo)]));
}

export type Saved = Point & { auto?: boolean; lane?: string };
type SlotAt = (depth: number, i: number) => Point;

const pinAt = (o: Point, p: Point): Point => ({ x: o.x + Math.max(24, p.x), y: o.y + Math.max(HEAD, p.y) });

// Saved offsets are relative to the lane origin, the same in every view, so a card keeps its spot across tabs and the All timeline.
// Only cards with no saved spot are auto-placed, into the first free slot, so adding a card never moves the others.
// A spot saved while the card sat in another lane no longer applies; the card gets a fresh free slot.
const spotFor = (n: MapNode, saved: Record<string, Saved>) => {
  const p = saved[n.id];
  return p && (!p.lane || p.lane === n.lane) ? p : undefined;
};

function placeLane(members: MapNode[], lane: { origin: Point; slotAt: SlotAt }, depth: Map<string, number>, saved: Record<string, Saved>): void {
  const { origin, slotAt } = lane;
  const taken = members.map((n) => spotFor(n, saved)).filter((p): p is Saved => Boolean(p)).map((p) => pinAt(origin, p));
  const seen = new Map<number, number>();
  for (const n of members) {
    const p = spotFor(n, saved);
    const d = depth.get(n.id) ?? 0;
    n.laneOrigin = origin;
    n.pinned = Boolean(p && !p.auto);
    if (p) { n.at = pinAt(origin, p); continue; }
    const i = freeSlot((k) => slotAt(d, k), seen.get(d) ?? 0, taken);
    seen.set(d, i + 1);
    n.at = slotAt(d, i);
    taken.push(n.at);
  }
}

// Stacked: lanes run top to bottom, depth columns are shared across lanes.
function placeStacked(nodes: MapNode[], laneOrder: string[], saved: Record<string, Saved>): void {
  const depth = depths(nodes, false);
  const start = columnStarts(nodes, depth, STACK_ROWS);
  let top = PAD;
  for (const lane of laneOrder) {
    const members = nodes.filter((m) => m.lane === lane);
    const y0 = top;
    const slotAt: SlotAt = (d, i) => ({ x: PAD + 24 + (start[d] + Math.floor(i / STACK_ROWS)) * COL, y: y0 + HEAD + (i % STACK_ROWS) * ROW });
    placeLane(members, { origin: { x: PAD, y: y0 }, slotAt }, depth, saved);
    top = Math.max(top, ...members.map((n) => n.at.y + NODE_H)) + 24 + LANE_GAP;
  }
}

// Across: lanes (phases) run left to right; inside a lane, cards flow by their dependencies within that lane.
function placeAcross(nodes: MapNode[], laneOrder: string[], saved: Record<string, Saved>): void {
  const depth = depths(nodes, true);
  let left = PAD;
  for (const lane of laneOrder) {
    const members = nodes.filter((m) => m.lane === lane);
    const start = columnStarts(members, depth, ROW_LANE_ROWS);
    const x0 = left;
    const slotAt: SlotAt = (d, i) => ({ x: x0 + 24 + (start[d] + Math.floor(i / ROW_LANE_ROWS)) * COL, y: PAD + HEAD + (i % ROW_LANE_ROWS) * ROW });
    placeLane(members, { origin: { x: x0, y: PAD }, slotAt }, depth, saved);
    left = Math.max(left + NODE_W + 48, ...members.map((n) => n.at.x + NODE_W + 24)) + LANE_GAP;
  }
}

export function placeNodes(nodes: MapNode[], laneOrder: string[], pinned: Record<string, Saved>, across: boolean): void {
  if (across) placeAcross(nodes, laneOrder, pinned);
  else placeStacked(nodes, laneOrder, pinned);
}

export function laneFrames(nodes: MapNode[], laneOrder: string[], across: boolean): MapLane[] {
  const bottom = Math.max(...nodes.map((n) => n.at.y + NODE_H)) + 24;
  return laneOrder.map((name, i) => {
    const members = nodes.filter((n) => n.lane === name);
    const xs = members.map((n) => n.at.x), ys = members.map((n) => n.at.y);
    const x = across ? members[0].laneOrigin.x : Math.min(...xs) - 24;
    const y = members[0].laneOrigin.y;
    const w = Math.max(...xs) + NODE_W + 24 - x;
    const h = (across ? bottom : Math.max(...ys) + NODE_H + 24) - y;
    return { name, x, y, w, h, tint: LANE_TINTS[i % LANE_TINTS.length] };
  });
}
