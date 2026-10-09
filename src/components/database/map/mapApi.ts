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

export async function createPage(workspaceId: string, databaseId: string, title: string): Promise<string | null> {
  const res = await send('/api/pages', 'POST', { workspaceId, databaseId, title });
  const page = await res.json().catch(() => null);
  return typeof page?.id === 'string' ? page.id : null;
}

export function createPhaseField(databaseId: string) {
  return send(`/api/databases/${databaseId}/properties`, 'POST', { name: 'Phase', type: 'select', databaseId, formula: '[]' });
}

export async function createWaitsOn(databaseId: string): Promise<{ id: string; name: string; type: string; formula: string }> {
  const res = await send(`/api/databases/${databaseId}/properties`, 'POST', {
    name: 'Waits on',
    type: 'relation',
    databaseId,
    formula: JSON.stringify({ targetDatabaseId: databaseId }),
  });
  return res.json();
}

export async function deleteProject(pageId: string, taskDbId?: string) {
  if (taskDbId) {
    const res = await fetch(`/api/databases/${taskDbId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`delete database ${taskDbId} failed: ${res.status}`);
  }
  const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete page ${pageId} failed: ${res.status}`);
}
