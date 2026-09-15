import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

// Pure ProseMirror helpers for the journal <-> database task bridge. A journal
// to-do "is" a database row when its paragraph carries a link to /page/<row>.
const ROW_HREF = /^\/page\/([a-z0-9]+)$/i;

export type PullItem = { pageId: string; title: string };

function firstLinkHref(paragraph: PMNode | null): string | null {
  let href: string | null = null;
  paragraph?.descendants((n) => {
    if (href) return false;
    const mark = n.marks.find((m) => m.type.name === 'link');
    if (mark) href = String(mark.attrs.href ?? '');
    return !href;
  });
  return href;
}

export function rowIdOf(item: PMNode): string | null {
  const href = firstLinkHref(item.firstChild);
  const m = href ? ROW_HREF.exec(href) : null;
  return m ? m[1] : null;
}

export function linkedTasks(editor: Editor): Map<string, boolean> {
  const out = new Map<string, boolean>();
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'taskItem') return true;
    const id = rowIdOf(node);
    if (id) out.set(id, Boolean(node.attrs.checked));
    return true;
  });
  return out;
}

export function taskItemAt(editor: Editor, li: Element): { pos: number; node: PMNode } | null {
  let inside: number;
  try {
    inside = editor.view.posAtDOM(li, 0);
  } catch {
    return null;
  }
  const $pos = editor.state.doc.resolve(inside);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'taskItem') return { pos: $pos.before(d), node };
  }
  return null;
}

export function linkifyTaskItem(editor: Editor, pos: number, href: string): void {
  const node = editor.state.doc.nodeAt(pos);
  const para = node?.firstChild;
  const text = para?.textContent.trim();
  if (!node || !para || !text) return;
  const from = pos + 2;
  const to = from + para.content.size;
  const { schema } = editor.state;
  const linked = schema.text(text, [schema.marks.link.create({ href })]);
  editor.view.dispatch(editor.state.tr.replaceWith(from, to, linked));
}

type ListHit = { pos: number; node: PMNode };

function todoList(doc: PMNode): ListHit | null {
  let underTodoHeading = false;
  let underHeading: ListHit | null = null;
  let first: ListHit | null = null;
  doc.forEach((node, offset) => {
    if (underHeading) return;
    if (node.type.name === 'heading') {
      underTodoHeading = /to-?do/i.test(node.textContent);
      return;
    }
    if (node.type.name !== 'taskList') return;
    first ??= { pos: offset, node };
    if (underTodoHeading) underHeading = { pos: offset, node };
  });
  return underHeading ?? first;
}

export function pickTodoEditor(editors: Editor[]): Editor | null {
  return editors.find((e) => todoList(e.state.doc)) ?? editors[0] ?? null;
}

export function insertPulledTasks(editor: Editor, items: PullItem[], existing: Set<string>): number {
  const { schema, doc } = editor.state;
  const fresh = items.filter((i) => !existing.has(i.pageId));
  if (!fresh.length) return 0;
  const nodes = fresh.map((i) =>
    schema.nodes.taskItem.create(
      { checked: false },
      schema.nodes.paragraph.create(
        null,
        schema.text(i.title || 'Untitled', [schema.marks.link.create({ href: `/page/${i.pageId}` })])
      )
    )
  );
  const list = todoList(doc);
  let tr = editor.state.tr;
  if (!list) {
    tr = tr.insert(doc.content.size, schema.nodes.taskList.create(null, nodes));
  } else {
    const endInside = list.pos + list.node.nodeSize - 1;
    const only = list.node.childCount === 1 ? list.node.firstChild : null;
    tr = only && !only.textContent.trim()
      ? tr.replaceWith(list.pos + 1, endInside, nodes)
      : tr.insert(endInside, nodes);
  }
  editor.view.dispatch(tr);
  return fresh.length;
}
