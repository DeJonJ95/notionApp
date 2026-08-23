// Convert the constrained HTML subset returned by /api/organize
// (<h1>-<h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>) into a TipTap doc
// JSON that /api/blocks accepts. Browser-only — it uses DOMParser — so
// import it from client components. `textToDoc` is the isomorphic fallback
// and is safe anywhere.

export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string }[];
};

export type TipTapDoc = { type: 'doc'; content: TipTapNode[] };

/** Split plain text into a paragraph-per-block doc. Empty paragraphs keep no content key. */
export function textToDoc(text: string): TipTapDoc {
  const paras = (text ?? '')
    .split(/\n{2,}/)
    .map((s) => s.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  const content: TipTapNode[] = (paras.length ? paras : ['']).map((p) =>
    p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' }
  );
  return { type: 'doc', content };
}

const MARK_FOR_TAG: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code',
};

function inlineNodes(el: Node): TipTapNode[] {
  const out: TipTapNode[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const text = child.textContent ?? '';
      if (text) out.push({ type: 'text', text });
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const tag = (child as Element).tagName.toLowerCase();
    const mark = MARK_FOR_TAG[tag] ?? null;
    if (tag === 'br') {
      out.push({ type: 'text', text: ' ' });
      return;
    }
    const inner = inlineNodes(child);
    if (mark) {
      for (const n of inner) {
        if (n.type === 'text') n.marks = [...(n.marks ?? []), { type: mark }];
      }
    }
    out.push(...inner);
  });
  return out;
}

function paragraph(el: Node): TipTapNode {
  const content = inlineNodes(el);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function listItems(listEl: Element): TipTapNode[] {
  const items: TipTapNode[] = [];
  listEl.querySelectorAll(':scope > li').forEach((li) => {
    items.push({ type: 'listItem', content: [paragraph(li)] });
  });
  return items.length ? items : [{ type: 'listItem', content: [{ type: 'paragraph' }] }];
}

/**
 * Parse an organize-style HTML fragment into a TipTap doc. Falls back to
 * `textToDoc` when there is no DOMParser (server) or parsing yields nothing.
 */
export function htmlToTipTapDoc(html: string): TipTapDoc {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined' || !html?.trim()) {
    return textToDoc(html ?? '');
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const content: TipTapNode[] = [];

  parsed.body.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = (node.textContent ?? '').trim();
      if (t) content.push({ type: 'paragraph', content: [{ type: 'text', text: t }] });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const inner = inlineNodes(el);
      if (inner.length) content.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: inner });
    } else if (tag === 'ul') {
      content.push({ type: 'bulletList', content: listItems(el) });
    } else if (tag === 'ol') {
      content.push({ type: 'orderedList', content: listItems(el) });
    } else if (tag === 'p') {
      content.push(paragraph(el));
    } else {
      // Any other wrapper (div, section, blockquote, …): flatten its inline text.
      const inner = inlineNodes(el);
      if (inner.length) content.push({ type: 'paragraph', content: inner });
    }
  });

  const nonEmpty = content.filter(
    (n) => n.content?.length || n.type === 'bulletList' || n.type === 'orderedList'
  );
  if (!nonEmpty.length) return textToDoc(parsed.body.textContent ?? html);
  return { type: 'doc', content: nonEmpty };
}
