'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';

/**
 * Floating drag handle that appears to the left of whichever top-level block
 * the cursor is hovering. Dragging it moves the entire block via ProseMirror's
 * native drop handling (view.dragging slice protocol).
 */
export function DragHandleOverlay({ editor }: { editor: Editor }) {
  const [handleStyle, setHandleStyle] = useState<{ top: number; left: number } | null>(null);
  const nodePosRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number>(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveBlock = useCallback(
    (clientX: number, clientY: number) => {
      const { view } = editor;
      const pmPos = view.posAtCoords({ left: clientX, top: clientY });
      if (!pmPos) return null;

      try {
        const inside = pmPos.inside > 0 ? pmPos.inside : pmPos.pos;
        const $pos = view.state.doc.resolve(inside);
        if ($pos.depth === 0) return null;
        const nodePos = $pos.before(1); // position of the top-level block
        const domNode = view.nodeDOM(nodePos);
        if (!(domNode instanceof Element)) return null;
        return { nodePos, domNode };
      } catch {
        return null;
      }
    },
    [editor]
  );

  useEffect(() => {
    const editorEl = editor.view.dom;

    const onMouseMove = (e: MouseEvent) => {
      if (draggingRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const result = resolveBlock(e.clientX, e.clientY);
        if (!result) { setHandleStyle(null); return; }

        const { nodePos, domNode } = result;
        nodePosRef.current = nodePos;

        const nodeRect = domNode.getBoundingClientRect();
        const editorRect = editorEl.getBoundingClientRect();
        setHandleStyle({
          top: nodeRect.top,
          left: editorRect.left - 26,
        });
      });
    };

    const onMouseLeave = () => {
      // Delay hiding so the mouse can travel to the handle without it vanishing
      hideTimerRef.current = setTimeout(() => {
        if (!draggingRef.current) setHandleStyle(null);
      }, 300);
    };

    editorEl.addEventListener('mousemove', onMouseMove);
    editorEl.addEventListener('mouseleave', onMouseLeave);
    return () => {
      editorEl.removeEventListener('mousemove', onMouseMove);
      editorEl.removeEventListener('mouseleave', onMouseLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [editor, resolveBlock]);

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      const nodePos = nodePosRef.current;
      if (nodePos === null) return;

      const { view } = editor;
      const { state } = view;
      const node = state.doc.nodeAt(nodePos);
      if (!node) return;

      draggingRef.current = true;

      // Select the block so ProseMirror knows what's being dragged
      const sel = NodeSelection.create(state.doc, nodePos);
      view.dispatch(state.tr.setSelection(sel));

      // Serialize to HTML for the dataTransfer (required for cross-window support)
      const serializer = DOMSerializer.fromSchema(state.schema);
      const frag = serializer.serializeFragment(sel.content().content);
      const wrapper = document.createElement('div');
      wrapper.appendChild(frag);

      e.dataTransfer.clearData();
      e.dataTransfer.setData('text/html', wrapper.innerHTML);
      e.dataTransfer.setData('text/plain', node.textContent);
      e.dataTransfer.effectAllowed = 'move';

      // Hand the slice to ProseMirror's drop handler so it moves (not copies) the block
      (view as any).dragging = { slice: sel.content(), move: true };
    },
    [editor]
  );

  const onDragEnd = useCallback(() => {
    draggingRef.current = false;
    // Clear in case drop never fired (e.g. dropped outside editor)
    (editor.view as any).dragging = null;
    setHandleStyle(null);
  }, [editor]);

  if (!handleStyle) return null;

  return (
    <div
      style={{ position: 'fixed', top: handleStyle.top, left: handleStyle.left, zIndex: 30 }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }}
      onMouseLeave={() => { if (!draggingRef.current) setHandleStyle(null); }}
      className="w-5 h-6 flex items-center justify-center cursor-grab text-muted/40 hover:text-muted select-none rounded hover:bg-surface transition-colors"
      title="Drag to reorder"
    >
      ⠿
    </div>
  );
}
