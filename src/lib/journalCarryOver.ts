type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type TipNode = {
  type?: string;
  text?: string;
  attrs?: { [key: string]: Json };
  marks?: Json[];
  content?: TipNode[];
};

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

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

// Carry-over order: yesterday's deliberate "Tomorrow's Priorities" first,
// then every to-do that was still unchecked anywhere on the page. Inline
// content is kept as-is so links (promoted task rows) survive the rollover.
export function extractCarryOver(blocks: { content: unknown }[]): TipNode[][] {
  const nodes = topLevelNodes(blocks);
  const items: TipNode[][] = [];
  const seen = new Set<string>();
  const push = (li: TipNode) => {
    const key = nodeText(li).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key || seen.has(key) || isChecked(li)) return;
    seen.add(key);
    items.push(inlineOf(li));
  };

  const start = nodes.findIndex(
    (n) => n.type === 'heading' && /tomorrow.{0,2}s\s+priorit/i.test(nodeText(n))
  );
  for (let j = start + 1; start !== -1 && j < nodes.length; j++) {
    const n = nodes[j];
    if (n.type === 'heading') break;
    if (LIST_TYPES.has(n.type ?? '')) (n.content ?? []).forEach(push);
  }
  for (const n of nodes) {
    if (n.type === 'taskList') (n.content ?? []).forEach(push);
  }
  return items;
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
