'use client';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useRef, useState, useEffect, useCallback } from 'react';

// ── Node View ────────────────────────────────────────────────────────────────

function ResizableImageView({ node, updateAttributes }: any) {
  const [isSelected, setIsSelected] = useState(false);
  // Live width during drag — stored in ref to avoid stale closure in pointerup
  const liveWidthRef = useRef<number | null>(null);
  const [displayWidth, setDisplayWidth] = useState<number | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const storedWidth: number | null = node.attrs.width;
  const currentWidth = displayWidth ?? storedWidth;

  // Tap/click image body → enter resize mode
  const handleImagePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    setIsSelected(true);
    e.stopPropagation(); // don't trigger canvas block drag
  };

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

  // Resize handle — pointer events with capture so drag works on mobile too
  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const currentW = containerRef.current?.offsetWidth ?? (storedWidth ?? 400);
    resizeRef.current = { startX: e.clientX, startW: currentW };
  }, [storedWidth]);

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    const newW = Math.max(80, resizeRef.current.startW + (e.clientX - resizeRef.current.startX));
    liveWidthRef.current = Math.round(newW);
    setDisplayWidth(Math.round(newW));
  }, []);

  const onResizePointerUp = useCallback(() => {
    if (resizeRef.current !== null && liveWidthRef.current !== null) {
      updateAttributes({ width: liveWidthRef.current });
    }
    resizeRef.current = null;
    liveWidthRef.current = null;
    setDisplayWidth(null);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper>
      <div
        ref={containerRef}
        className="group/img relative inline-block max-w-full select-none"
        style={{ width: currentWidth ? `${currentWidth}px` : '100%' }}
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
            onPointerDown={(e) => { e.stopPropagation(); setIsSelected(true); }}
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
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
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
      mergeAttributes(rest, {
        style: width ? `width:${width}px;max-width:100%` : 'max-width:100%',
      }),
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

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
