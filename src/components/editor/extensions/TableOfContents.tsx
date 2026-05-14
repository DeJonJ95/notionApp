'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';

interface TocItem {
  level: number;
  text: string;
  index: number; // DOM order index among h1/h2/h3 elements
}

function scrollToHeading(editor: Editor, index: number) {
  const els = editor.view.dom.querySelectorAll('h1, h2, h3');
  const el = els[index];
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function TableOfContents({
  editor,
  isFullscreen = false,
}: {
  editor: Editor;
  isFullscreen?: boolean;
}) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const rebuildItems = useCallback(() => {
    const next: TocItem[] = [];
    let idx = 0;
    editor.state.doc.forEach((node) => {
      if (node.type.name === 'heading') {
        next.push({ level: node.attrs.level, text: node.textContent, index: idx++ });
      }
    });
    setItems(next);
  }, [editor]);

  // Scrollspy via IntersectionObserver on heading elements
  const setupObserver = useCallback(() => {
    observerRef.current?.disconnect();
    const els = Array.from(editor.view.dom.querySelectorAll('h1, h2, h3'));
    if (els.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const el = visible[0].target;
          const idx = els.indexOf(el as HTMLElement);
          if (idx !== -1) setActiveIndex(idx);
        }
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0.1 }
    );
    els.forEach((el) => observerRef.current!.observe(el));
  }, [editor]);

  useEffect(() => {
    rebuildItems();
    editor.on('update', rebuildItems);
    return () => {
      editor.off('update', rebuildItems);
      observerRef.current?.disconnect();
    };
  }, [editor, rebuildItems]);

  useEffect(() => {
    if (items.length === 0) return;
    setupObserver();
  }, [items, setupObserver]);

  if (items.length === 0) return null;

  const containerClass = isFullscreen
    ? 'w-52 shrink-0 border-l border-border bg-surface/40 overflow-y-auto py-8 px-4'
    : 'fixed right-4 top-20 w-52 hidden xl:block z-10';

  return (
    <div className={containerClass}>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">
        On this page
      </div>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.index}
            onClick={() => scrollToHeading(editor, item.index)}
            style={{ paddingLeft: `${(item.level - 1) * 10}px` }}
            className={`block w-full text-left text-xs py-1 px-1 rounded truncate transition-colors ${
              activeIndex === item.index
                ? 'text-accent font-medium bg-accent/10'
                : 'text-muted hover:text-text hover:bg-surface'
            }`}
          >
            {item.text || '(untitled)'}
          </button>
        ))}
      </nav>
    </div>
  );
}
