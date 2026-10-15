import type { Editor } from '@tiptap/react';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { liveEditors } from '@/lib/editorRegistry';
import { todoKey } from '@/lib/assist/todoKey';

// Finds a journal to-do again by its text: positions shift as the person types,
// and the assistant panel can stay open across edits.
type Hit = { editor: Editor; pos: number; node: PMNode };

export function findTodo(key: string): Hit | null {
  for (const editor of liveEditors()) {
    let hit: Hit | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (hit) return false;
      if (node.type.name === 'taskItem' && todoKey(node.firstChild?.textContent ?? '') === key) hit = { editor, pos, node };
      return !hit;
    });
    if (hit) return hit;
  }
  return null;
}

export function markTodoDone(key: string): boolean {
  const hit = findTodo(key);
  if (!hit) return false;
  hit.editor.view.dispatch(hit.editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, checked: true }));
  return true;
}

function appendInside(key: string, build: (schema: Schema) => PMNode): boolean {
  const hit = findTodo(key);
  if (!hit) return false;
  const end = hit.pos + hit.node.nodeSize - 1;
  hit.editor.view.dispatch(hit.editor.state.tr.insert(end, build(hit.editor.state.schema)));
  return true;
}

const para = (schema: Schema, text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);

/** Adds the steps as sub-to-dos nested under the to-do. */
export function insertSteps(key: string, steps: string[]): boolean {
  return appendInside(key, (schema) =>
    schema.nodes.taskList.create(null, steps.map((s) => schema.nodes.taskItem.create({ checked: false }, para(schema, s)))),
  );
}

/** Adds text under the to-do as a quote, one paragraph per line. */
export function insertQuote(key: string, text: string): boolean {
  const lines = text.split('\n').map((l) => l.trimEnd());
  return appendInside(key, (schema) => schema.nodes.blockquote.create(null, lines.map((l) => para(schema, l))));
}
