import { valueOf, type MapDb, type MapNode, type MapProp, type MapProps } from './mapModel';
import type { TaskPanel } from './MapTasks';
import type { useTasks } from './useTaskProgress';

type Tasks = ReturnType<typeof useTasks>;
type Deps = { db: MapDb; props: MapProps; tasks: Tasks; setValue: (pageId: string, prop: MapProp, value: unknown) => void };

// A database whose rows point at task lists is a map of projects; any other map is a map of tasks.
export function mapPanels({ db, props, tasks, setValue }: Deps) {
  const isProjects = Boolean(props.taskDb || props.tasks);
  const owns = (id: string) => Boolean(tasks.sourceFor(id)?.whole);
  const noun = isProjects ? 'project' : 'task';

  const taskPanel = (n: MapNode): TaskPanel | undefined => {
    if (!isProjects) return undefined;
    const prop = props.taskDb;
    const page = db.pages.find((p) => p.id === n.id);
    const picker = prop && page ? {
      value: String(valueOf(page, prop) ?? ''),
      workspaceId: db.workspaceId, selfId: db.id, onChange: (dbId: string) => setValue(n.id, prop, dbId),
    } : undefined;
    return { items: tasks.items[n.id] ?? [], color: n.color, toggle: tasks.toggle, add: (t) => tasks.add(n.id, t), canAdd: Boolean(tasks.sourceFor(n.id)), picker };
  };

  return {
    noun,
    emptySubtitle: isProjects ? 'No next action yet' : '',
    taskPanel,
    openHref: (id: string) => (owns(id) ? `/database/${tasks.sourceFor(id)!.dbId}?view=map` : `/page/${id}`),
    openLabel: (id: string) => (owns(id) ? 'Open its map' : `Open ${noun}`),
    cycleProjects: (nodes: MapNode[]) => nodes.filter((n) => n.label !== 'Archived' && owns(n.id)).map((n) => ({ id: n.id, title: n.title, lane: n.lane })),
  };
}
