type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type TipNode = {
  type?: string;
  text?: string;
  attrs?: { [key: string]: Json };
  marks?: Json[];
  content?: TipNode[];
};

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const PRIORITIES_RE = /tomorrow.{0,2}s\s+priorit/i;
const ROW_HREF = /^\/page\/([a-z0-9]+)$/i;

export function nodeText(node: TipNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(nodeText).join('');
}

// A journal page may still be one legacy `document` block or several canvas
// text blocks; either way the top-level nodes are read in order.
function topLevelNodes(blocks: { content: unknown }[]): TipNode[] {
  const nodes: TipNode[] = [];
  for (const b of blocks) {
    const c = b.content as TipNode | null;
    if (c?.content) nodes.push(...c.content);
  }
  return nodes;
}

function inlineOf(listItem: TipNode): TipNode[] {
  const para = listItem.content?.find((n) => n.type === 'paragraph');
  return para?.content ?? [];
}

function isChecked(item: TipNode): boolean {
  return item.attrs?.checked === true;
}

function rowIdOf(inline: TipNode[]): string | null {
  for (const n of inline) {
    for (const m of n.marks ?? []) {
      const mark = m as { type?: string; attrs?: { href?: unknown } } | null;
      const href = mark?.type === 'link' ? String(mark.attrs?.href ?? '') : '';
      const hit = ROW_HREF.exec(href);
      if (hit) return hit[1];
    }
  }
  return null;
}

type Candidate = { text: string; rowId: string | null; inline: TipNode[] };

function candidate(li: TipNode): Candidate | null {
  const text = nodeText(li).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text || isChecked(li)) return null;
  const inline = inlineOf(li);
  return { text, rowId: rowIdOf(inline), inline };
}

// Every list that sits under a "Tomorrow's Priorities" heading, wherever it
// is: the template's own section and the one the evening review appends.
function priorityItems(nodes: TipNode[]): TipNode[] {
  const out: TipNode[] = [];
  let under = false;
  for (const n of nodes) {
    if (n.type === 'heading') under = PRIORITIES_RE.test(nodeText(n));
    else if (under && LIST_TYPES.has(n.type ?? '')) out.push(...(n.content ?? []));
  }
  return out;
}

// A linked to-do (a database row) always beats a plain one with the same
// text, and identical rows are carried once.
function dedupe(cands: Candidate[]): TipNode[][] {
  const linkedTexts = new Set(cands.filter((c) => c.rowId).map((c) => c.text));
  const seen = new Set<string>();
  const out: TipNode[][] = [];
  for (const c of cands) {
    const key = c.rowId ? `row:${c.rowId}` : `text:${c.text}`;
    if (seen.has(key) || (!c.rowId && linkedTexts.has(c.text))) continue;
    seen.add(key);
    out.push(c.inline);
  }
  return out;
}

// Carry-over order: yesterday's deliberate "Tomorrow's Priorities" first,
// then every to-do that was still unchecked anywhere on the page. Inline
// content is kept as-is so links (promoted task rows) survive the rollover.
export function extractCarryOver(blocks: { content: unknown }[]): TipNode[][] {
  const nodes = topLevelNodes(blocks);
  const leftovers = nodes.filter((n) => n.type === 'taskList').flatMap((n) => n.content ?? []);
  const cands = [...priorityItems(nodes), ...leftovers]
    .map(candidate)
    .filter((c): c is Candidate => c !== null);
  return dedupe(cands);
}

export function journalTemplate(carry: TipNode[][]): TipNode {
  const taskItems: TipNode[] = (carry.length ? carry : [[]]).map((inline) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [{ type: 'paragraph', content: inline }],
  }));

  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: "✅ Today's To-Do List" }] },
      { type: 'taskList', content: taskItems },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '💭 Journal' }] },
      { type: 'paragraph' },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: "🌅 Tomorrow's Priorities" }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
    ],
  };
}
