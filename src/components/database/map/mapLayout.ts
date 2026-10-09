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

// Within a wrapped column, cards that feed others go in the right-most sub-column so their arrows never pass behind a card.
function feedersLast(list: MapNode[], feeders: Set<string>): MapNode[] {
  return [...list.filter((n) => !feeders.has(n.id)), ...list.filter((n) => feeders.has(n.id))];
}

function depths(nodes: MapNode[], sameLaneOnly: boolean): Map<string, number> {
  const laneOf = new Map(nodes.map((n) => [n.id, n.lane]));
  const deps = new Map(nodes.map((n) => [n.id, sameLaneOnly ? n.deps.filter((d) => laneOf.get(d) === n.lane) : n.deps]));
  const memo = new Map<string, number>();
  return new Map(nodes.map((n) => [n.id, depthOf(n.id, deps, memo)]));
}

// Stacked: lanes run top to bottom, depth columns are shared across lanes. Pinned offsets are relative to the lane's top.
function placeStacked(nodes: MapNode[], laneOrder: string[], pinned: Record<string, Point>): void {
  const depth = depths(nodes, false);
  const start = columnStarts(nodes, depth, STACK_ROWS);
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
      const col = start[d] + Math.floor(i / STACK_ROWS);
      n.pinned = Boolean(p);
      n.laneOrigin = { x: 0, y: top };
      n.at = p ? { x: Math.max(8, p.x), y: top + Math.max(HEAD, p.y) } : { x: PAD + 24 + col * COL, y: top + HEAD + (i % STACK_ROWS) * ROW };
      bottom = Math.max(bottom, n.at.y + NODE_H);
    }
    top = bottom + 24 + LANE_GAP;
  }
}

// Across: lanes (phases) run left to right; inside a lane, cards flow by their dependencies within that lane. Pinned offsets are relative to the lane's left edge.
function placeAcross(nodes: MapNode[], laneOrder: string[], pinned: Record<string, Point>): void {
  const depth = depths(nodes, true);
  const feeders = new Set(nodes.flatMap((n) => n.deps));
  let left = PAD;
  for (const lane of laneOrder) {
    const members = feedersLast(nodes.filter((m) => m.lane === lane), feeders);
    const start = columnStarts(members, depth, ROW_LANE_ROWS);
    const seen = new Map<number, number>();
    let right = left + NODE_W + 48;
    for (const n of members) {
      const d = depth.get(n.id) ?? 0;
      const i = seen.get(d) ?? 0;
      seen.set(d, i + 1);
      const p = pinned[n.id];
      const col = start[d] + Math.floor(i / ROW_LANE_ROWS);
      n.pinned = Boolean(p);
      n.laneOrigin = { x: left, y: 0 };
      n.at = p ? { x: left + Math.max(24, p.x), y: Math.max(PAD + HEAD, p.y) } : { x: left + 24 + col * COL, y: PAD + HEAD + (i % ROW_LANE_ROWS) * ROW };
      right = Math.max(right, n.at.x + NODE_W + 24);
    }
    left = right + LANE_GAP;
  }
}

export function placeNodes(nodes: MapNode[], laneOrder: string[], pinned: Record<string, Point>, across: boolean): void {
  if (across) placeAcross(nodes, laneOrder, pinned);
  else placeStacked(nodes, laneOrder, pinned);
}

export function laneFrames(nodes: MapNode[], laneOrder: string[], across: boolean): MapLane[] {
  const bottom = Math.max(...nodes.map((n) => n.at.y + NODE_H)) + 24;
  return laneOrder.map((name, i) => {
    const members = nodes.filter((n) => n.lane === name);
    const xs = members.map((n) => n.at.x), ys = members.map((n) => n.at.y);
    const x = across ? members[0].laneOrigin.x : Math.min(...xs) - 24;
    const y = across ? PAD : members[0].laneOrigin.y;
    const w = Math.max(...xs) + NODE_W + 24 - x;
    const h = (across ? bottom : Math.max(...ys) + NODE_H + 24) - y;
    return { name, x, y, w, h, tint: LANE_TINTS[i % LANE_TINTS.length] };
  });
}
