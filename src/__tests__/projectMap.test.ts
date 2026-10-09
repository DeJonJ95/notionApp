import { buildModel, detectProps, downstreamOf, type MapDb } from '@/components/database/map/mapModel';
import { sourceOf } from '@/components/database/map/useTaskProgress';

const DB = 'db1';
const props = [
  { id: 'st', name: 'Status', type: 'select', formula: '["Planned","In progress","Done"]' },
  { id: 'ar', name: 'Area', type: 'select', formula: '["Work","Home"]' },
  { id: 'wo', name: 'Waits on', type: 'relation', formula: JSON.stringify({ targetDatabaseId: DB }) },
  { id: 'nx', name: 'Next action', type: 'text' },
];

function page(id: string, status: string, area: string, deps: string[] = []) {
  return {
    id,
    title: id.toUpperCase(),
    properties: [
      { property: { id: 'st' }, value: status },
      { property: { id: 'ar' }, value: area },
      { property: { id: 'wo' }, value: deps },
    ],
  };
}

const db: MapDb = {
  id: DB,
  workspaceId: 'ws',
  properties: props,
  pages: [
    page('a', 'Done', 'Work'),
    page('b', 'Planned', 'Work', ['a']),
    page('c', 'Planned', 'Work', ['b']),
    page('d', 'In progress', 'Home'),
  ],
};

describe('project map model', () => {
  const p = detectProps(db);

  it('finds status, area, self-relation and next-action properties', () => {
    expect([p.status?.id, p.lane?.id, p.waitsOn?.id, p.next?.id]).toEqual(['st', 'ar', 'wo', 'nx']);
  });

  it('marks planned work ready only when everything upstream is done', () => {
    const m = buildModel(db, p, {});
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    expect(by.a.status).toBe('done');
    expect(by.b.status).toBe('ready');
    expect(by.c.status).toBe('waiting');
    expect(by.c.label).toBe('Waiting on 1');
    expect(by.d.status).toBe('active');
  });

  it('places nodes left to right by dependency depth and lanes top to bottom', () => {
    const m = buildModel(db, p, {});
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n.at]));
    expect(by.a.x).toBeLessThan(by.b.x);
    expect(by.b.x).toBeLessThan(by.c.x);
    expect(by.d.y).toBeGreaterThan(by.a.y);
    expect(m.lanes.map((l) => l.name)).toEqual(['Work', 'Home']);
    expect(m.edges).toHaveLength(2);
  });

  it('places a pinned node relative to its lane and pushes later lanes down', () => {
    const before = buildModel(db, p, {});
    const m = buildModel(db, p, { c: { x: 900, y: 400 } });
    const c = m.nodes.find((n) => n.id === 'c')!;
    expect(c.at).toEqual({ x: 900, y: c.laneTop + 400 });
    expect(c.pinned).toBe(true);
    const [work, home] = m.lanes;
    expect(home.y).toBeGreaterThanOrEqual(work.y + work.h);
    expect(home.y).toBeGreaterThan(before.lanes[1].y);
  });

  it('survives a dependency cycle', () => {
    const cyclic = { ...db, pages: [page('x', 'Planned', 'Work', ['y']), page('y', 'Planned', 'Work', ['x'])] };
    expect(() => buildModel(cyclic, p, {})).not.toThrow();
  });

  it('collects everything downstream so a cycle cannot be added', () => {
    const m = buildModel(db, p, {});
    expect(Array.from(downstreamOf('a', m.nodes)).sort()).toEqual(['a', 'b', 'c']);
  });

  it('prefers a row\'s own task database over the Tasks relation', () => {
    const withSource: MapDb = {
      ...db,
      properties: [...props, { id: 'tk', name: 'Tasks', type: 'relation', formula: JSON.stringify({ targetDatabaseId: 'tasksDb' }) }, { id: 'td', name: 'Task database', type: 'text' }],
    };
    const sp = detectProps(withSource);
    expect(sp.taskDb?.id).toBe('td');
    const own = { id: 'x', title: 'X', properties: [{ property: { id: 'td' }, value: 'ownDb' }] };
    expect(sourceOf(own, sp)).toEqual({ dbId: 'ownDb', whole: true });
    expect(sourceOf({ id: 'y', title: 'Y', properties: [] }, sp)).toEqual({ dbId: 'tasksDb', whole: false });
  });

});

describe('project map wrapping and grouping', () => {
  const p = detectProps(db);

  it('wraps a tall stack into extra columns while keeping dependents to the right', () => {
    const many: MapDb = { ...db, pages: [...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => page(id, 'Planned', 'Work')), page('z', 'Planned', 'Home', ['p1'])] };
    const m = buildModel(many, p, {});
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n.at]));
    expect(new Set(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => by[id].x)).size).toBe(2);
    expect(Math.max(...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => by[id].y)) - by.p1.y).toBeLessThan(3 * 140);
    expect(by.z.x).toBeGreaterThan(Math.max(...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => by[id].x)));
  });

  it('puts a feeder in the sub-column next to its dependents when a column wraps', () => {
    const many: MapDb = { ...db, pages: [page('f', 'Planned', 'Work'), ...['q1', 'q2', 'q3', 'q4'].map((id) => page(id, 'Planned', 'Work')), page('z', 'Planned', 'Work', ['f'])] };
    const by = Object.fromEntries(buildModel(many, p, {}).nodes.map((n) => [n.id, n.at]));
    expect(by.f.x).toBe(Math.max(...['f', 'q1', 'q2', 'q3', 'q4'].map((id) => by[id].x)));
  });

  it('groups by a Phase field ahead of Area and names the ungrouped band after it', () => {
    const phased: MapDb = {
      ...db,
      properties: [...props, { id: 'ph', name: 'Phase', type: 'select', formula: '["Planning","Setup"]' }],
      pages: [{ ...page('a', 'Done', 'Work'), properties: [...page('a', 'Done', 'Work').properties, { property: { id: 'ph' }, value: 'Setup' }] }, page('b', 'Planned', 'Work')],
    };
    const pp = detectProps(phased);
    expect(pp.lane?.id).toBe('ph');
    expect(buildModel(phased, pp, {}).lanes.map((l) => l.name)).toEqual(['Setup', 'No phase']);
  });
});
