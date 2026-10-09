import { prisma } from '@/lib/prisma';
import { detectProps } from '@/components/database/map/mapModel';
import { nextCycleValue } from './cycle';

const TASK_FIELDS = [
  { name: 'Status', type: 'select', options: ['Not Started', 'In Progress', 'Complete'] },
  { name: 'Phase', type: 'select', options: [] },
  { name: 'Due Date', type: 'date' },
  { name: 'Assignee', type: 'text' },
];

// A new card on a projects map comes with its own task list (fields, Waits on, Map view) already linked.
export async function createProjectWithTasks(userId: string, mapDbId: string, title: string) {
  const map = await prisma.database.findFirst({ where: { id: mapDbId, workspace: { ownerId: userId } }, include: { properties: true } });
  if (!map) return null;
  const props = detectProps({ id: map.id, workspaceId: map.workspaceId, properties: map.properties, pages: [] });
  if (!props.taskDb) return null;
  return prisma.$transaction(async (tx) => {
    const db = await tx.database.create({ data: { name: title, workspaceId: map.workspaceId } });
    await tx.property.createMany({
      data: [
        ...TASK_FIELDS.map((f, i) => ({ name: f.name, type: f.type, formula: f.options ? JSON.stringify(f.options) : null, position: (i + 1) * 1024, databaseId: db.id })),
        { name: 'Waits on', type: 'relation', formula: JSON.stringify({ targetDatabaseId: db.id }), position: 5 * 1024, databaseId: db.id },
      ],
    });
    await tx.view.createMany({ data: [{ name: 'Map', type: 'map', databaseId: db.id }, { name: 'All tasks', type: 'table', databaseId: db.id }] });
    const row = await tx.page.create({ data: { title, workspaceId: map.workspaceId, databaseId: map.id, authorId: userId } });
    const status = props.status ? nextCycleValue(props.status, null, 0, true) : null;
    await tx.propertyValue.createMany({
      data: [
        { propertyId: props.taskDb!.id, pageId: row.id, value: db.id },
        ...(props.status && status ? [{ propertyId: props.status.id, pageId: row.id, value: String(status) }] : []),
      ],
    });
    return { id: row.id, taskDbId: db.id };
  });
}
