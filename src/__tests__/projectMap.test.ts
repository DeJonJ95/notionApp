import { buildModel, detectProps, downstreamOf, type MapDb } from '@/components/database/map/mapModel';

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

  it('lets a hand-placed position override the auto layout', () => {
    const m = buildModel(db, p, { c: { x: 900, y: 20 } });
    const c = m.nodes.find((n) => n.id === 'c')!;
    expect(c.at).toEqual({ x: 900, y: 20 });
    expect(c.pinned).toBe(true);
  });

  it('survives a dependency cycle', () => {
    const cyclic = { ...db, pages: [page('x', 'Planned', 'Work', ['y']), page('y', 'Planned', 'Work', ['x'])] };
    expect(() => buildModel(cyclic, p, {})).not.toThrow();
  });

  it('collects everything downstream so a cycle cannot be added', () => {
    const m = buildModel(db, p, {});
    expect(Array.from(downstreamOf('a', m.nodes)).sort()).toEqual(['a', 'b', 'c']);
  });
});
