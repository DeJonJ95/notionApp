/** @jest-environment node */
// Each lookup in the mock matches only when the where clause names the owner,
// so a check that forgets workspace.ownerId fails these tests.
const OWNER = 'u1';
const rows = {
  workspace: [{ id: 'w1', ownerId: OWNER }, { id: 'w2', ownerId: 'u2' }],
  database: [{ id: 'd1', ws: 'w1' }, { id: 'd2', ws: 'w2' }],
  page: [{ id: 'p1', ws: 'w1' }, { id: 'p2', ws: 'w2' }],
};
const ownerOf = (ws: string) => rows.workspace.find((w) => w.id === ws)?.ownerId;
type Where = { id: string; ownerId?: string; workspace?: { ownerId?: string } };

jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findFirst: ({ where }: { where: Where }) => Promise.resolve(rows.workspace.find((w) => w.id === where.id && w.ownerId === where.ownerId) ?? null) },
    database: { findFirst: ({ where }: { where: Where }) => Promise.resolve(rows.database.find((d) => d.id === where.id && ownerOf(d.ws) === where.workspace?.ownerId) ?? null) },
    page: { findFirst: ({ where }: { where: Where }) => Promise.resolve(rows.page.find((p) => p.id === where.id && ownerOf(p.ws) === where.workspace?.ownerId) ?? null) },
  },
}));

import { linksOwned, ownedDatabase, ownedPage, ownsWorkspace, relationTargetOk } from '@/lib/ownership';

describe('ownership', () => {
  it('finds only records in workspaces the user owns', async () => {
    expect(await ownsWorkspace(OWNER, 'w1')).toBe(true);
    expect(await ownsWorkspace(OWNER, 'w2')).toBe(false);
    expect(await ownedDatabase(OWNER, 'd2')).toBeNull();
    expect(await ownedPage(OWNER, 'p1')).toBeTruthy();
    expect(await ownedPage(OWNER, 'p2')).toBeNull();
  });

  it('rejects a page linked to anyone else’s workspace, database or parent', async () => {
    expect(await linksOwned(OWNER, { workspaceId: 'w1', databaseId: 'd1', parentId: 'p1' })).toBe(true);
    expect(await linksOwned(OWNER, { workspaceId: 'w1', databaseId: null, parentId: undefined })).toBe(true);
    expect(await linksOwned(OWNER, { workspaceId: 'w1', databaseId: 'd2' })).toBe(false);
    expect(await linksOwned(OWNER, { parentId: 'p2' })).toBe(false);
    expect(await linksOwned(OWNER, { workspaceId: 'w2' })).toBe(false);
  });

  it('lets a relation point only at the user’s own databases', async () => {
    expect(await relationTargetOk(OWNER, 'relation', JSON.stringify({ targetDatabaseId: 'd1' }))).toBe(true);
    expect(await relationTargetOk(OWNER, 'relation', JSON.stringify({ targetDatabaseId: 'd2' }))).toBe(false);
    expect(await relationTargetOk(OWNER, 'select', JSON.stringify(['a']))).toBe(true);
    expect(await relationTargetOk(OWNER, 'relation', 'not json')).toBe(true);
  });
});
