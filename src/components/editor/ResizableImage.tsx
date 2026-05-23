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

  // Tap/click image body — selects + lets the parent block decide
  // whether the same gesture is a drag.
  //
  // Critical: we NEVER stopPropagation from this handler anymore. That
  // way a single tap-and-drag gesture (Canva-style) works on the first
  // try — the bubbling pointerdown reaches the surrounding block's
  // handlePointerDown and the block's fast-path takes over.
  //
  // For the block's fast-path to know "an image is selected" within
  // the SAME event, we synchronously call onSelectedChange(true) here
  // before the event finishes bubbling. React's setIsSelected is
  // async, but the storage callback is a normal function — it runs
  // now, so the parent block's imageSelectedRef is updated by the time
  // its handler fires.
  const handleImagePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) return;
    if (e.altKey) return; // Alt+drag is for moving the block at the block level

    if (!isSelected) {
      setIsSelected(true);
      // Sync the parent's imageSelectedRef NOW so the bubbling
      // pointerdown sees us as "already selected" in the same tick.
      editor?.storage?.image?.onSelectedChange?.(true);
      // Blur the editor so iOS doesn't pop the keyboard.
      editor?.commands?.blur?.();
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    // Do NOT stopPropagation in either branch — the block needs this
    // event to decide whether the user is tapping (no movement) or
    // dragging (movement).
  };

  // Notify the host (canvas block) whenever selection state flips so it
  // can toggle drag-immediately-to-move mode. (handleImagePointerDown
  // does this synchronously on the up-transition too — this effect
  // handles the down-transition and is a safety net for any path that
  // changes isSelected without going through that handler.)
  useEffect(() => {
    editor?.storage?.image?.onSelectedChange?.(isSelected);
  }, [isSelected, editor]);

  // Suppress the iOS soft keyboard while an image is selected. iOS
  // focuses the surrounding contenteditable on touchend regardless of
  // how fast we call blur(); inputmode="none" is the documented way to
  // keep the keyboard from popping up at all. We restore the attribute
  // when the image is deselected so text editing works again.
  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    if (isSelected) {
      const prev = dom.getAttribute('inputmode');
      dom.setAttribute('inputmode', 'none');
      return () => {
        if (prev === null) dom.removeAttribute('inputmode');
        else dom.setAttribute('inputmode', prev);
      };
    }
  }, [isSelected, editor]);

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

  // ── Two-finger pinch-to-resize on selected image ──────────────────
  // Canva-style: once an image is selected, two fingers on the image
  // scale it proportionally. Carefully gated so the canvas-level pinch
  // (which zooms the whole page) still works in every other case.
  //
  // Disambiguation: the gesture is treated as "resize this image" only
  // when BOTH fingers land within (or near) the image's bounding box.
  // If either finger is outside the image, we leave the touch event
  // alone — it bubbles to the scroll-container's pinch handler and
  // the canvas zooms instead. The "near" margin lets users press just
  // outside the image edge without the gesture failing.
  useEffect(() => {
    if (!isSelected) return;
    const el = containerRef.current;
    if (!el) return;

    let pinchState: { initialDist: number; initialW: number } | null = null;

    const within = (t: Touch, rect: DOMRect) =>
      t.clientX >= rect.left - 20 && t.clientX <= rect.right + 20 &&
      t.clientY >= rect.top - 20 && t.clientY <= rect.bottom + 20;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const rect = el.getBoundingClientRect();
      if (!within(e.touches[0], rect) || !within(e.touches[1], rect)) return;
      // Both fingers on this image — claim the gesture.
      e.stopPropagation();
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchState = {
        initialDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        initialW: el.offsetWidth || (storedWidth ?? 400),
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinchState || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchState.initialDist;
      const newW = Math.round(Math.max(80, pinchState.initialW * ratio));
      liveWidthRef.current = newW;
      setDisplayWidth(newW);
      // Live-sync the canvas block width so the block follows the image
      editor?.storage?.image?.onResize?.(newW, false);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!pinchState) return;
      if (e.touches.length < 2) {
        if (liveWidthRef.current !== null) {
          const finalW = liveWidthRef.current;
          updateAttributes({ width: finalW });
          editor?.storage?.image?.onResize?.(finalW, true);
        }
        pinchState = null;
        liveWidthRef.current = null;
        setDisplayWidth(null);
      }
    };

    // Native listeners (not React props) so we can use {passive: false}
    // and call preventDefault inside touchmove — that's what stops the
    // browser from also trying to scroll/zoom during the gesture.
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isSelected, storedWidth, updateAttributes, editor]);

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

        {/* Active resize affordances — shown in resize mode.
            Canva-style: four corner dots make the bounding box obvious
            ("this is selected and resizable") while keeping a single
            grab-draggable handle at the bottom-right. On touch the dots
            are larger (5/5) than on hover-capable devices (3/3). */}
        {isSelected && (
          <>
            {/* Top-left and top-right corner indicators (visual only) */}
            <div
              className="absolute -top-1.5 -left-1.5 rounded-full bg-accent border-2 border-white shadow z-10 pointer-events-none
                         w-3 h-3 [@media(hover:none)]:w-5 [@media(hover:none)]:h-5"
            />
            <div
              className="absolute -top-1.5 -right-1.5 rounded-full bg-accent border-2 border-white shadow z-10 pointer-events-none
                         w-3 h-3 [@media(hover:none)]:w-5 [@media(hover:none)]:h-5"
            />
            {/* Bottom-left indicator (visual only — the interactive
                grab handle is the BR one below). */}
            <div
              className="absolute -bottom-1.5 -left-1.5 rounded-full bg-accent border-2 border-white shadow z-10 pointer-events-none
                         w-3 h-3 [@media(hover:none)]:w-5 [@media(hover:none)]:h-5"
            />
            {/* Bottom-right grab handle — the one users drag */}
            <div
              data-resize-handle
              onPointerDown={onResizePointerDown}
              title="Drag to resize"
              className="absolute -bottom-1.5 -right-1.5 rounded-full bg-accent border-2 border-white shadow-md z-10 cursor-se-resize
                         w-3 h-3 [@media(hover:none)]:w-5 [@media(hover:none)]:h-5"
              style={{ touchAction: 'none' }}
            />
            {/* Width label */}
            {currentWidth && (
              <div className="absolute -top-6 left-0 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
                {currentWidth}px
              </div>
            )}
            {/* Mobile pinch hint — replaces the "tap outside" hint since
                pinch is now the primary resize gesture on touch. */}
            <div className="absolute -top-6 right-0 text-[10px] text-white bg-accent/80 px-1.5 py-0.5 rounded pointer-events-none [@media(hover:any)]:hidden">
              pinch or drag a corner
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

  // The host (CanvasTextBlock) writes callbacks here so the canvas block
  // can react to image-internal state:
  //   - onResize: keep block width in sync with image width.
  //   - onSelectedChange: know when an image is selected so the block
  //     can treat a subsequent drag as "move me" without waiting for
  //     the 400ms long-press the unselected path uses.
  addStorage() {
    return {
      onResize: null as null | ((width: number, isFinal: boolean) => void),
      onSelectedChange: null as null | ((selected: boolean) => void),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
