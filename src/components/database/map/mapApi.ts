import type { Saved } from './mapLayout';

async function send(url: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return res;
}

export function saveValue(pageId: string, propertyId: string, value: unknown) {
  return send('/api/property-values', 'PUT', { pageId, propertyId, value: value === '' ? null : value });
}

export function savePositions(databaseId: string, viewId: string, positions: Record<string, Saved>) {
  return send(`/api/databases/${databaseId}/views/${viewId}`, 'PATCH', { grouping: { positions } });
}

export async function createPage(workspaceId: string, databaseId: string, title: string): Promise<string | null> {
  const res = await send('/api/pages', 'POST', { workspaceId, databaseId, title });
  const page = await res.json().catch(() => null);
  return typeof page?.id === 'string' ? page.id : null;
}

// Creates a task with its Status set to the first "not begun" option, so it never starts blank.
export async function createTask(workspaceId: string, databaseId: string, title: string, status?: { id: string; value: string | null }) {
  const id = await createPage(workspaceId, databaseId, title);
  if (id && status?.value) await saveValue(id, status.id, status.value);
  return id;
}

export async function createProjectWithTasks(mapDbId: string): Promise<string | null> {
  const res = await send('/api/projects/new', 'POST', { mapDbId });
  const made = await res.json().catch(() => null);
  return typeof made?.id === 'string' ? made.id : null;
}

export function renameDatabase(databaseId: string, name: string) {
  return send(`/api/databases/${databaseId}`, 'PATCH', { name });
}

export function renamePage(pageId: string, title: string) {
  return send(`/api/pages/${pageId}`, 'PATCH', { title });
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
