// One assistant turn for a journal to-do. A fresh turn routes the to-do,
// gathers the context that kind of help needs, and generates; a follow-up
// reuses the stored context and refines the last result.

import type { AssistThread, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { completeJson, parseJsonObject, type LlmMessage } from './llm';
import { catalog, loadProject, resolveTarget, type Target } from './projects';
import { linkedRow, searchNotes } from './notes';
import { ROUTER_SYSTEM, briefText, routerText, systemFor } from './prompts';
import { parseResult, parseRoute, projectText, type Route } from './parse';
import { todoKey } from './todoKey';
import { quickRoute } from './quickRoute';
import type { AssistIntent, AssistResult, ChatMessage, ThreadView } from './types';

export type TurnInput = { userId: string; firstName: string; pageId: string; todo: string; today: string; linkedRowId?: string | null; message?: string };

type Ctx = { target?: Target; notes?: string; linked?: string; pending?: 'target'; options?: string[]; lastOutput?: string };

const MAX_OUTPUT_CHARS = 6000;

function readCtx(v: Prisma.JsonValue | null): Ctx {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Ctx) : {};
}

function readMessages(v: Prisma.JsonValue): ChatMessage[] {
  return Array.isArray(v) ? (v as ChatMessage[]) : [];
}

export function toView(t: AssistThread): ThreadView {
  return {
    id: t.id,
    todoText: t.todoText,
    intent: t.intent as ThreadView['intent'],
    messages: readMessages(t.messages),
    result: (t.result as AssistResult | null) ?? null,
    canUndo: !!t.undo,
  };
}

async function route(input: TurnInput, linked: string | undefined, targets: Target[]): Promise<Route> {
  const quick = linked ? null : quickRoute(input.todo, targets);
  if (quick) return quick;
  const content = await completeJson(
    [{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content: routerText(input.todo, linked, targets.map((t) => t.name)) }],
    { op: 'assist-route', userId: input.userId, maxTokens: 200, temperature: 0, timeoutMs: 30_000 },
  );
  return parseRoute(parseJsonObject(content));
}

async function gather(input: TurnInput): Promise<{ ctx: Ctx; intent: AssistIntent } | { ask: Ctx }> {
  const targets = await catalog(input.userId);
  const row = input.linkedRowId ? await linkedRow(input.userId, input.linkedRowId) : null;
  const linked = row ? `${row.title} (in ${row.databaseName}). ${row.fields}\n${row.text}`.trim() : undefined;
  const r = await route(input, linked, targets);
  const rowTarget = row ? targets.find((t) => t.databaseId === row.databaseId) : undefined;
  const target = resolveTarget(targets, r.target) ?? (r.intent === 'project' ? rowTarget : undefined);
  if (r.intent === 'project' && !target) {
    return { ask: { pending: 'target', options: targets.slice(0, 8).map((t) => t.name), linked } };
  }
  const notes = r.search ? await searchNotes(input.userId, r.search, [input.pageId, input.linkedRowId ?? '']) : [];
  const notesText = notes.map((n) => `## ${n.title}\n${n.text}`).join('\n\n') || undefined;
  return { intent: r.intent, ctx: { target, linked, notes: notesText } };
}

async function generate(input: TurnInput, intent: AssistIntent, ctx: Ctx, history: LlmMessage[]) {
  const data = intent === 'project' && ctx.target ? await loadProject(input.userId, ctx.target.databaseId, ctx.target.name) : null;
  if (intent === 'project' && !data) throw new Error('That project could not be loaded.');
  const brief = briefText({ todo: input.todo, today: input.today, firstName: input.firstName, linked: ctx.linked, notes: ctx.notes, project: data ? projectText(data) : undefined });
  const content = await completeJson(
    [{ role: 'system', content: systemFor(intent) }, { role: 'user', content: brief }, ...history],
    { op: `assist-${intent}`, userId: input.userId, maxTokens: intent === 'project' ? 3000 : 1500, timeoutMs: 75_000 },
  );
  const result = parseResult(intent, parseJsonObject(content), data ? { data, today: input.today } : undefined);
  return { result, lastOutput: content.slice(0, MAX_OUTPUT_CHARS) };
}

function askForTarget(ctx: Ctx): AssistResult {
  const options = ctx.options ?? [];
  const text = options.length ? 'Which project or task list should I change?' : 'You have no projects or task lists yet. Create a projects map first, then try again.';
  return { intent: 'answer', text, reply: text, suggestions: [], question: options.length ? { text, options } : undefined };
}

async function freshTurn(input: TurnInput) {
  const got = await gather(input);
  if ('ask' in got) return { intent: 'project' as const, ctx: got.ask, result: askForTarget(got.ask) };
  const { result, lastOutput } = await generate(input, got.intent, got.ctx, []);
  return { intent: got.intent, ctx: { ...got.ctx, lastOutput }, result };
}

async function followUp(input: TurnInput, thread: AssistThread, message: string) {
  const ctx = readCtx(thread.context);
  if (ctx.pending === 'target') {
    const target = resolveTarget(await catalog(input.userId), message);
    if (!target) return { intent: 'project' as const, ctx, result: askForTarget(ctx) };
    const next: Ctx = { target, linked: ctx.linked };
    const { result, lastOutput } = await generate(input, 'project', next, []);
    return { intent: 'project' as const, ctx: { ...next, lastOutput }, result };
  }
  const intent = thread.intent as AssistIntent;
  const history: LlmMessage[] = [{ role: 'assistant', content: ctx.lastOutput ?? '{}' }, { role: 'user', content: `Follow-up instruction: ${message}` }];
  const { result, lastOutput } = await generate(input, intent, ctx, history);
  return { intent, ctx: { ...ctx, lastOutput }, result };
}

/** Runs one turn and saves it on the to-do's thread. */
export async function runTurn(input: TurnInput): Promise<AssistThread> {
  const key = todoKey(input.todo);
  const where = { userId_pageId_todoKey: { userId: input.userId, pageId: input.pageId, todoKey: key } };
  const existing = await prisma.assistThread.findUnique({ where });
  const message = input.message?.trim();
  const turn = existing && message && existing.intent !== 'pending' ? await followUp(input, existing, message) : await freshTurn(input);
  const said: ChatMessage[] = [...(message ? [{ role: 'user' as const, content: message }] : []), { role: 'assistant', content: turn.result.reply || 'Done.' }];
  const messages = [...(existing && message ? readMessages(existing.messages) : []), ...said];
  const data = {
    todoText: input.todo,
    intent: turn.intent,
    context: turn.ctx as Prisma.InputJsonObject,
    messages,
    result: turn.result,
  };
  return prisma.assistThread.upsert({
    where,
    create: { userId: input.userId, pageId: input.pageId, todoKey: key, ...data },
    update: data,
  });
}
