import type { Point } from './mapModel';

async function send(url: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return res;
}

export function saveValue(pageId: string, propertyId: string, value: unknown) {
  return send('/api/property-values', 'PUT', { pageId, propertyId, value: value === '' ? null : value });
}

export function savePositions(databaseId: string, viewId: string, positions: Record<string, Point>) {
  return send(`/api/databases/${databaseId}/views/${viewId}`, 'PATCH', { grouping: { positions } });
}

export async function createProject(workspaceId: string, databaseId: string): Promise<string | null> {
  const res = await send('/api/pages', 'POST', { workspaceId, databaseId, title: 'Untitled project' });
  const page = await res.json().catch(() => null);
  return typeof page?.id === 'string' ? page.id : null;
}

export function createWaitsOn(databaseId: string) {
  return send(`/api/databases/${databaseId}/properties`, 'POST', {
    name: 'Waits on',
    type: 'relation',
    databaseId,
    formula: JSON.stringify({ targetDatabaseId: databaseId }),
  });
}
