// Model JSON in, typed assist results out. Every field is coerced; prose is
// held to house style here rather than trusted to the prompt.

import { plainDashes } from '@/lib/prose';
import { planChanges } from './projectPlan';
import { fillIns } from './blanks';
import type { ProjectData } from './projects';
import type { AssistIntent, AssistResult, DraftResult } from './types';

export { fillIns };

type Obj = Record<string, unknown>;

const INTENTS: AssistIntent[] = ['draft', 'project', 'steps', 'answer'];

const text = (v: unknown) => plainDashes(typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown, max: number) => (Array.isArray(v) ? v.map(text).filter(Boolean).slice(0, max) : []);

export type Route = { intent: AssistIntent; target: string | null; search: string | null };

export function parseRoute(o: Obj): Route {
  const intent = INTENTS.find((i) => i === o.intent) ?? 'answer';
  const target = typeof o.target === 'string' && o.target.trim() ? o.target.trim() : null;
  const search = typeof o.search === 'string' && o.search.trim() ? o.search.trim().slice(0, 80) : null;
  return { intent, target, search };
}

function draft(o: Obj): DraftResult {
  const kind = (['email', 'message', 'document'] as const).find((k) => k === o.kind) ?? 'email';
  const to = text(o.to), subject = text(o.subject), body = text(o.body);
  return { intent: 'draft', kind, to, subject, body, fillIns: fillIns(to, subject, body), reply: text(o.reply), suggestions: texts(o.suggestions, 3) };
}

export function parseResult(intent: AssistIntent, o: Obj, project?: { data: ProjectData; today: string }): AssistResult {
  const common = { reply: text(o.reply), suggestions: texts(o.suggestions, 3) };
  if (intent === 'draft') return draft(o);
  if (intent === 'steps') return { intent, steps: texts(o.steps, 10), ...common };
  if (intent === 'project' && project) {
    const { data, today } = project;
    return { intent, target: { databaseId: data.databaseId, name: data.name }, summary: text(o.summary), changes: planChanges(o.changes, data, today), ...common };
  }
  return { intent: 'answer', text: text(o.text), ...common };
}

/** The task list as the model sees it: one line per task, with ids for updates. */
export function projectText(data: ProjectData): string {
  const lines = data.tasks.map((t) =>
    [`id=${t.id}`, `title="${t.title}"`, `status=${t.status || '-'}`, `phase=${t.phase || '-'}`, `due=${t.due || '-'}`, `waitsOn=[${t.waitsOn.join(',')}]`].join(' '),
  );
  return [
    `NAME: ${data.name}`,
    `STATUSES: ${data.statusOptions.join(', ') || 'none'}`,
    `PHASES: ${data.phaseOptions.join(', ') || 'none'}`,
    `FIELDS: ${[data.props.phase && 'phase', data.props.due && 'due', data.props.waitsOn && 'waitsOn'].filter(Boolean).join(', ') || 'status only'}`,
    `TASKS (${data.tasks.length}):`,
    ...(lines.length ? lines : ['(no tasks yet)']),
  ].join('\n');
}
