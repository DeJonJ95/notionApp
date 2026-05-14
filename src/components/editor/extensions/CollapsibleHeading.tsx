'use client';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';

const collapseKey = new PluginKey('headingCollapse');

// ── TipTap extension ─────────────────────────────────────────────────────────
// Stores which heading positions are collapsed in editor.storage and applies
// display:none decorations to content between a collapsed heading and the next
// heading at the same level or above.

export const HeadingCollapseExtension = Extension.create({
  name: 'headingCollapse',

  addStorage() {
    return { collapsed: new Set<number>() };
  },

  addProseMirrorPlugins() {
    const { storage } = this; // captured by closure so decorations see live state

    return [
      new Plugin({
        key: collapseKey,
        props: {
          decorations(state) {
            const { doc } = state;
            const collapsed = storage.collapsed as Set<number>;
            const decorations: Decoration[] = [];
            let activeCollapseLevel: number | null = null;

            doc.forEach((node, offset) => {
              if (node.type.name === 'heading') {
                const level = node.attrs.level as number;
                if (activeCollapseLevel !== null) {
                  if (level <= activeCollapseLevel) {
                    // This heading ends the active collapse (same/higher hierarchy)
                    activeCollapseLevel = null;
                    if (collapsed.has(offset)) activeCollapseLevel = level;
                    // Don't hide this heading — it's the new section header
                  } else {
                    // Nested heading inside collapsed range — hide it
                    decorations.push(
                      Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' })
                    );
                  }
                } else {
                  if (collapsed.has(offset)) activeCollapseLevel = level;
                }
              } else if (activeCollapseLevel !== null) {
                decorations.push(
                  Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' })
                );
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

// ── React overlay ─────────────────────────────────────────────────────────────
// Renders collapse-toggle buttons fixed to the left of each heading in the
// editor. Always visible (low opacity) so users can discover them.

interface HeadingHandle {
  pos: number;
  top: number;
  left: number;
  collapsed: boolean;
}

export function CollapsibleHeadingOverlay({ editor }: { editor: Editor }) {
  const [handles, setHandles] = useState<HeadingHandle[]>([]);
  const rafRef = useRef<number>(0);

  const rebuild = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const { view, state } = editor;
      const storage = editor.storage.headingCollapse as { collapsed: Set<number> };
      const next: HeadingHandle[] = [];

      state.doc.forEach((node, offset) => {
        if (node.type.name !== 'heading') return;
        const domNode = view.nodeDOM(offset);
        if (!(domNode instanceof Element)) return;
        const rect = domNode.getBoundingClientRect();
        next.push({
          pos: offset,
          top: rect.top + rect.height / 2 - 8,
          left: rect.left - 22,
          collapsed: storage.collapsed.has(offset),
        });
      });

      setHandles(next);
    });
  }, [editor]);

  useEffect(() => {
    rebuild();
    editor.on('update', rebuild);
    editor.on('selectionUpdate', rebuild);
    window.addEventListener('scroll', rebuild, true);
    window.addEventListener('resize', rebuild);
    return () => {
      editor.off('update', rebuild);
      editor.off('selectionUpdate', rebuild);
      window.removeEventListener('scroll', rebuild, true);
      window.removeEventListener('resize', rebuild);
      cancelAnimationFrame(rafRef.current);
    };
  }, [editor, rebuild]);

  const toggle = useCallback(
    (pos: number) => {
      const storage = editor.storage.headingCollapse as { collapsed: Set<number> };
      if (storage.collapsed.has(pos)) storage.collapsed.delete(pos);
      else storage.collapsed.add(pos);
      // Dispatch a no-op transaction so the decoration plugin reruns
      editor.view.dispatch(editor.state.tr.setMeta('headingCollapse', true));
      rebuild();
    },
    [editor, rebuild]
  );

  return (
    <>
      {handles.map(({ pos, top, left, collapsed }) => (
        <button
          key={pos}
          style={{ position: 'fixed', top, left, zIndex: 20 }}
          onClick={() => toggle(pos)}
          className="w-4 h-4 flex items-center justify-center text-[9px] text-muted/30 hover:text-accent hover:bg-surface rounded select-none transition-colors"
          title={collapsed ? 'Expand section' : 'Collapse section'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
      ))}
    </>
  );
}
