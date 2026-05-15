'use client';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useRef, useState, useEffect, useCallback } from 'react';

// ── Node View ────────────────────────────────────────────────────────────────

function ResizableImageView({ node, updateAttributes, editor }: any) {
  const [isSelected, setIsSelected] = useState(false);
  // Live width during drag — stored in ref to avoid stale closure in pointerup
  const liveWidthRef = useRef<number | null>(null);
  const [displayWidth, setDisplayWidth] = useState<number | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const storedWidth: number | null = node.attrs.width;
  const currentWidth = displayWidth ?? storedWidth;

  // Tap/click image body → enter resize mode.
  // EXCEPTION: if Alt is held (desktop) or the touch landed on the block's
  // drag handle, let the event bubble up so the canvas block can be dragged.
  const handleImagePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) return;
    if (e.altKey) return; // allow Alt+drag to move the whole block
    setIsSelected(true);
    e.stopPropagation();
  };

  // First-load auto-size: when an image is added without an explicit width,
  // clamp its natural size to a sensible default and tell the canvas block to
  // size to match. Otherwise huge uploads create huge block footprints that
  // cover content underneath even after the user shrinks the image.
  useEffect(() => {
    if (storedWidth !== null) return;
    const img = containerRef.current?.querySelector('img');
    if (!img) return;
    const setInitial = () => {
      if (!img.naturalWidth) return;
      const w = Math.min(img.naturalWidth, 600);
      updateAttributes({ width: w });
      editor?.storage?.image?.onResize?.(w, true);
    };
    if (img.complete && img.naturalWidth > 0) {
      setInitial();
    } else {
      img.addEventListener('load', setInitial, { once: true });
      return () => img.removeEventListener('load', setInitial);
    }
  }, [storedWidth, updateAttributes, editor]);

  // Click/touch outside the image → exit resize mode
  useEffect(() => {
    if (!isSelected) return;
    const handler = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as globalThis.Node)) {
        setIsSelected(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [isSelected]);

  // Resize via document-level pointer events so the finger can leave the
  // image (and even leave the viewport edge) without losing the drag.
  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const currentW = containerRef.current?.offsetWidth ?? (storedWidth ?? 400);
    resizeRef.current = { startX: e.clientX, startW: currentW };

    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const newW = Math.round(Math.max(80, resizeRef.current.startW + (ev.clientX - resizeRef.current.startX)));
      liveWidthRef.current = newW;
      setDisplayWidth(newW);
      // Live-sync the canvas block width too so the block follows the image
      editor?.storage?.image?.onResize?.(newW, false);
      if (ev.cancelable) ev.preventDefault();
    };

    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      if (resizeRef.current !== null && liveWidthRef.current !== null) {
        const finalW = liveWidthRef.current;
        updateAttributes({ width: finalW });
        editor?.storage?.image?.onResize?.(finalW, true);
      }
      resizeRef.current = null;
      liveWidthRef.current = null;
      setDisplayWidth(null);
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  }, [storedWidth, updateAttributes, editor]);

  return (
    <NodeViewWrapper>
      <div
        ref={containerRef}
        className="group/img relative inline-block select-none"
        // Constrained to the parent block (max-width:100%) so the image can
        // never overflow its block box and cover neighbouring blocks. It can
        // still be made large — resizing it grows the block too (the
        // onResize callback syncs canvasWidth), so block always >= image.
        style={{ width: currentWidth ? `${currentWidth}px` : 'auto', maxWidth: '100%' }}
        contentEditable={false}
        onPointerDown={handleImagePointerDown}
      >
        {/* The image */}
        <img
          src={node.attrs.src}
          alt={node.attrs.alt ?? ''}
          draggable={false}
          className="block w-full h-auto rounded"
          style={{
            outline: isSelected ? '2px solid var(--color-accent, #6366f1)' : 'none',
            outlineOffset: 2,
            maxWidth: '100%',
          }}
        />

        {/* Resize icon — visible on hover (desktop) or always (mobile) */}
        {!isSelected && (
          <div
            title="Tap to resize"
            className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded bg-black/50 text-white
                       flex items-center justify-center cursor-pointer
                       opacity-0 group-hover/img:opacity-100 [@media(hover:none)]:opacity-70
                       transition-opacity"
            onPointerDown={(e) => {
              if (e.altKey) return; // let Alt-drag bubble up to move the block
              e.stopPropagation();
              setIsSelected(true);
            }}
          >
            {/* Simple resize arrow glyph */}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 9L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M5 9H9V5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}

        {/* Active resize handle — shown in resize mode */}
        {isSelected && (
          <>
            {/* Corner drag handle */}
            <div
              data-resize-handle
              onPointerDown={onResizePointerDown}
              title="Drag to resize"
              className="absolute -bottom-1.5 -right-1.5 rounded cursor-se-resize
                         bg-accent shadow-md z-10
                         w-4 h-4 [@media(hover:none)]:w-6 [@media(hover:none)]:h-6"
              style={{ touchAction: 'none' }}
            />
            {/* Width label */}
            {currentWidth && (
              <div className="absolute -top-6 left-0 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
                {currentWidth}px
              </div>
            )}
            {/* Exit hint on mobile */}
            <div className="absolute -top-6 right-0 text-[10px] text-white bg-accent/80 px-1.5 py-0.5 rounded pointer-events-none [@media(hover:any)]:hidden">
              tap outside to exit
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ── TipTap Extension ─────────────────────────────────────────────────────────

export const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: '' },
      title: { default: null },
      width: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const wStyle = img.style.width;
          return {
            src:   img.getAttribute('src'),
            alt:   img.getAttribute('alt') ?? '',
            title: img.getAttribute('title'),
            width: wStyle ? parseInt(wStyle) : (img.width || null),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width, ...rest } = HTMLAttributes;
    return [
      'img',
      mergeAttributes(rest, width ? { style: `width:${width}px` } : {}),
    ];
  },

  addCommands() {
    return {
      setImage:
        (options: Record<string, any>) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs: options }),
    } as any;
  },

  // The host (CanvasTextBlock) writes a callback here so the canvas block
  // can size to match the rendered image.
  addStorage() {
    return {
      onResize: null as null | ((width: number, isFinal: boolean) => void),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
