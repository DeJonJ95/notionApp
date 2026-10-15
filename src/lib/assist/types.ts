// Shapes shared by the assist routes and the journal panel. Client code imports
// these as types only.

export type AssistIntent = 'draft' | 'project' | 'steps' | 'answer';

export type Question = { text: string; options: string[] };

type Common = { reply: string; suggestions: string[]; question?: Question };

export type DraftResult = Common & {
  intent: 'draft';
  kind: 'email' | 'message' | 'document';
  to: string;
  subject: string;
  body: string;
  fillIns: string[];
};

export type StepsResult = Common & { intent: 'steps'; steps: string[] };

export type AnswerResult = Common & { intent: 'answer'; text: string };

export type FieldChange = { field: 'title' | 'status' | 'phase' | 'due' | 'waitsOn'; before: string; after: string };

/** One validated change to a task list; `ref` names a task this plan adds. */
export type PlannedChange = {
  op: 'add' | 'update';
  taskId?: string;
  ref?: string;
  title: string;
  set: { title?: string; status?: string; phase?: string; due?: string | null; waitsOn?: string[] };
  fields: FieldChange[];
  reason: string;
  warnings: string[];
};

export type ProjectResult = Common & {
  intent: 'project';
  target: { databaseId: string; name: string };
  summary: string;
  changes: PlannedChange[];
  applied?: { at: string; count: number; undone?: boolean };
};

export type AssistResult = DraftResult | StepsResult | AnswerResult | ProjectResult;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ThreadView = {
  id: string;
  todoText: string;
  intent: AssistIntent | 'pending';
  messages: ChatMessage[];
  result: AssistResult | null;
  canUndo: boolean;
};
