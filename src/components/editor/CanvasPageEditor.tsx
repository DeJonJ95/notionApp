'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Star, Trash2, Sparkles, ImageIcon, Database, Mic, ClipboardList, GripVertical, X, Plus, Youtube, Music2, Palette, Pin, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code, ZoomIn, ZoomOut, Maximize2, Bold, Italic, Underline, Strikethrough, Link2, Minus, Undo2, Redo2, BookOpen } from 'lucide-react';
import { CanvasTextBlock } from '@/components/editor/CanvasTextBlock';
import { OrganizeModal } from '@/components/extract/OrganizeModal';
import { AudioRecorder } from '@/components/editor/AudioRecorder';
import { SummarizeModal } from '@/components/editor/SummarizeModal';
import { YouTubeImportModal } from '@/components/editor/YouTubeImportModal';
import { TikTokImportModal } from '@/components/editor/TikTokImportModal';
import { MoodBoardModal } from '@/components/moodboard/MoodBoardModal';
import { promptDialog, toast } from '@/components/ui/feedback';

// Break circular dep: CanvasPageEditor → DatabaseView → CanvasPageEditor
const DatabaseViewDynamic = dynamic(
  () => import('@/components/database/DatabaseView').then((m) => m.DatabaseView),
  { ssr: false, loading: () => <div className="p-4 text-muted text-sm">Loading database…</div> }
);

// Fetches database by ID then renders DatabaseView — mirrors DatabaseEmbedView logic
function CanvasDatabaseBlock({ databaseId, onSelect }: { databaseId: string | null; onSelect?: (databaseId: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [workspaceDbs, setWorkspaceDbs] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(() => {
    if (!databaseId) return;
    fetch(`/api/databases/${databaseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, [databaseId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (databaseId) return;
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((ws: any[]) => setWorkspaceDbs(ws.flatMap((w) => w.databases ?? [])))
      .catch(() => {});
  }, [databaseId]);

  if (!databaseId) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-sm font-medium text-text mb-2">Embed a database</div>
        {workspaceDbs.length === 0 ? (
          <div className="text-sm text-muted">No databases found. Create one first.</div>
        ) : (
          <select
            className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none"
            defaultValue=""
            onChange={(e) => { if (e.target.value) onSelect?.(e.target.value); }}
          >
            <option value="" disabled>Choose a database…</option>
            {workspaceDbs.map((db) => <option key={db.id} value={db.id}>{db.name}</option>)}
          </select>
        )}
      </div>
    );
  }

  if (!data) return <div className="p-3 text-sm text-muted">Loading…</div>;

  return <DatabaseViewDynamic database={data} onUpdate={load} />;
}

// ——— Types ————————————————————————————————————————————————————————————————

export type CanvasBlockData = {
  id: string;
  type: string; // 'text' | 'database' | 'image'
  content: any;
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
};

type PageData = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  isFavorite: boolean;
};

// ——— Auto-migrate old single-document blocks ————————————————————————————

// Rough height estimate for vertical stacking on migration.
function estimateNodeHeight(node: any): number {
  if (node.type === 'heading') {
    const lvl = node.attrs?.level ?? 1;
    return lvl === 1 ? 56 : lvl === 2 ? 44 : 36;
  }
  if (node.type === 'paragraph') {
    const chars = (node.content ?? []).reduce(
      (n: number, c: any) => n + (c.text?.length ?? 0), 0
    );
    return 30 + Math.floor(chars / 60) * 26;
  }
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
    return Math.max(1, node.content?.length ?? 1) * 28;
  }
  if (node.type === 'codeBlock') return 80;
  if (node.type === 'blockquote') return 60;
  if (node.type === 'image') return 200;
  return 32;
}

// Default column for stacked content (Notion-style left margin).
const DOC_X = 80;
const DOC_W_TEXT = 720;
const DOC_W_DB = 640; // slightly narrower than text so the DB doesn't dominate the canvas
const BLOCK_GAP = 18;
const MIN_BLOCK_W = 240;
const MAX_BLOCK_W = 2400;

function docToCanvasBlocks(doc: any): Omit<CanvasBlockData, 'id'>[] {
  const nodes: any[] = doc?.content ?? [];
  const out: Omit<CanvasBlockData, 'id'>[] = [];
  let y = 60;
  let j = 0;

  while (j < nodes.length) {
    const n = nodes[j];

    if (n.type === 'databaseEmbed') {
      out.push({
        type: 'database',
        content: { databaseId: n.attrs?.databaseId ?? null },
        canvasX: DOC_X,
        canvasY: y,
        canvasWidth: DOC_W_DB,
      });
      y += 420 + BLOCK_GAP;
      j++;
      continue;
    }

    // Group a heading with the content that follows it, up to the next same-level heading
    const isHeading = n.type === 'heading';
    const lvl = isHeading ? (n.attrs?.level ?? 99) : 99;
    const group: any[] = [n];
    let groupH = estimateNodeHeight(n);
    j++;
    if (isHeading && lvl <= 2) {
      while (j < nodes.length) {
        const nx = nodes[j];
        if (nx.type === 'heading' && (nx.attrs?.level ?? 99) <= lvl) break;
        if (nx.type === 'databaseEmbed') break;
        group.push(nx);
        groupH += estimateNodeHeight(nx);
        j++;
      }
    }

    out.push({
      type: 'text',
      content: { type: 'doc', content: group },
      canvasX: DOC_X,
      canvasY: y,
      canvasWidth: DOC_W_TEXT,
    });
    y += Math.max(40, groupH) + BLOCK_GAP;
  }
  return out;
}

// ——— Individual Canvas Card ———————————————————————————————————————————————

function CanvasCard({
  block,
  zoom,
  isMoving,
  onDragStart,
  onDelete,
  onContentUpdate,
  onBlockEmpty,
  registerEditor,
  onHover,
  onFocusChange,
  onResize,
  onResizeEnd,
  onResizeHeight,
  onResizeHeightEnd,
  onDoubleTap,
  onInsertDatabase,
}: {
  block: CanvasBlockData;
  zoom: number;
  isMoving: boolean;
  onDragStart: (blockId: string, cx: number, cy: number, ox: number, oy: number, pointerId: number) => void;
  onDelete: (id: string) => void;
  onContentUpdate: (id: string, content: any) => void;
  onBlockEmpty: (id: string) => void;
  registerEditor: (id: string, editor: any) => void;
  onHover: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  onResize: (id: string, width: number) => void;
  onResizeEnd: (id: string) => void;
  onResizeHeight?: (id: string, height: number) => void;
  onResizeHeightEnd?: (id: string) => void;
  onDoubleTap?: (block: CanvasBlockData) => void;
  onInsertDatabase?: () => void;
}) {
  // True while the user is intentionally moving this block on touch —
  // either because the parent says so (drag committed) or because the
  // long-press timer just fired. Drives mobile drag-bar visibility so
  // the bar stays invisible until the user actually wants to move.
  const [longPressActive, setLongPressActive] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  const lastPointerIdRef = useRef(-1);
  // Set when a second pointer arrives during the image-selected fast-path
  // (indicating a 2-finger pinch). Blocks subsequent fast-path drags from
  // starting — without this the second finger's 80ms timer fires mid-pinch
  // and drags the block while the user is trying to resize.
  const dragBlockedRef = useRef(false);
  // Keep longPressActive in sync with the parent's isMoving — when the
  // drag ends (isMoving flips false) we clear our local flag too.
  useEffect(() => {
    if (!isMoving) setLongPressActive(false);
  }, [isMoving]);

  // Tracks whether any image inside this block's editor is currently
  // selected. When true, we want a single-finger drag on the image to
  // move the block IMMEDIATELY (no 400ms long-press wait) — Canva style.
  // Set via a callback that ResizableImage fires through editor.storage.
  const imageSelectedRef = useRef(false);
  const handleImageSelectedChange = useCallback((selected: boolean) => {
    imageSelectedRef.current = selected;
  }, []);

  // When an image inside this block resizes, follow it with the block width
  // so the block doesn't extend past the visible content.
  const handleImageResize = useCallback(
    (w: number, isFinal: boolean) => {
      const clamped = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, w));
      onResize(block.id, clamped);
      if (isFinal) onResizeEnd(block.id);
    },
    [block.id, onResize, onResizeEnd]
  );

  const beginDrag = (cx: number, cy: number, pointerId: number) => {
    onDragStart(block.id, cx, cy, block.canvasX, block.canvasY, pointerId);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    const onHandle = (e.target as HTMLElement).closest('[data-drag-handle]');

    // Drag handle tap or Alt-drag: start immediately
    if (onHandle || e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      beginDrag(e.clientX, e.clientY, e.pointerId);
      return;
    }

    // Touch only — desktop already has the hover handle + Alt-drag.
    if (e.pointerType !== 'touch') return;

    // Double-tap detection — zoom to 100% centered on this block.
    if (onDoubleTap) {
      const now = Date.now();
      // On mobile, sequential taps get different pointerIds, so use
	      // a time-based fallback when an image is selected.
	      const samePointer = e.pointerId === lastPointerIdRef.current;
	      const timeGap = now - lastTapRef.current;
	      if (timeGap < 300 && (samePointer || imageSelectedRef.current)) {
        e.preventDefault();
        e.stopPropagation();
        lastTapRef.current = 0;
        lastPointerIdRef.current = -1;
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        // Double-tap on a selected image = drag instead of zoom
	        if (imageSelectedRef.current) {
	          beginDrag(e.clientX, e.clientY, e.pointerId);
	          return;
	        }
	        onDoubleTap(block);
        return;
      }
      lastTapRef.current = now;
      lastPointerIdRef.current = e.pointerId;
    }

        // CANVA-STYLE FAST PATH: an image inside this block is already selected,
    // so a single-finger drag should move the block IMMEDIATELY without
    // the 400ms long-press wait. To not also hijack two-finger pinch (which
    // resizes the image), wait ~80ms before committing the drag - if a
    // second pointer arrives in that window, the user was starting a pinch
    // and we cancel.
    if (imageSelectedRef.current) {
      // A second finger already cancelled a previous pointer's drag
      // (2-finger pinch) - don't start another drag for this finger.
      if (dragBlockedRef.current) return;

      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let cancelled = false;
      const onSecondTouch = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) {
          cancelled = true;
          dragBlockedRef.current = true;
          cleanup();
          const resetGuard = () => { dragBlockedRef.current = false; };
          document.addEventListener('pointerup', resetGuard, { once: true });
          document.addEventListener('pointercancel', resetGuard, { once: true });
        }
      };
      const cleanup = () => {
        // {capture: true} on remove must match the registration below.
        document.removeEventListener('pointerdown', onSecondTouch, true);
      };
      // CAPTURE PHASE is critical. React's synthetic events dispatch from
      // the root container during the BUBBLE phase; a non-capturing
      // document listener fires after that. Without {capture: true}, when
      // finger 2's pointerdown arrives:
      //   1. Event bubbles to React root → handlePointerDown(finger2) runs
      //      → checks dragBlockedRef (still false) → enters fast path,
      //        starts its own 80ms timer.
      //   2. Event continues to document → this listener fires →
      //      sets dragBlockedRef = true. (Too late — finger 2 is already in.)
      // 80ms later finger 2's timer fires, beginDrag runs with finger 2's
      // coords, and the block teleports between fingers.
      //
      // With capture, document → this listener runs FIRST, sets the flag,
      // THEN the event reaches React and handlePointerDown(finger2) sees
      // dragBlockedRef === true and returns immediately.
      document.addEventListener('pointerdown', onSecondTouch, true);
      setTimeout(() => {
        cleanup();
        if (!cancelled) beginDrag(startX, startY, pointerId);
      }, 80);
      return;
    }

    // SLOW PATH: long-press anywhere on the block (excluding image content;
    // ResizableImage's own pointerdown stopsPropagation while not selected)
    // initiates a drag. Cancels on early movement (scroll attempt) or
    // pointerup before the 400ms timer fires.
    // Skip if the touch landed on an image — the image has its own gesture
    // (tap to enter resize mode).
    if ((e.target as HTMLElement).closest('img')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const LONG_PRESS_MS = 400;
    const CANCEL_DELTA_SQ = 5 * 5; // ~5px wobble allowance before we treat as scroll

    const cleanup = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      document.removeEventListener('pointerdown', onSecondPointer);
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy > CANCEL_DELTA_SQ) cleanup();
    };
    const onEnd = () => {
      cleanup();
      // If the timer hasn't fired yet, the press was just a tap — nothing
      // to undo. If it HAS fired, longPressActive will reset via the
      // isMoving effect when the parent's drag wraps up.
      if (!isMoving) setLongPressActive(false);
    };
    // A second finger landing means the user is starting a pinch.
    // Cancel the long-press so we don't pop the drag bar mid-zoom.
    const onSecondPointer = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) {
        cleanup();
        setLongPressActive(false);
      }
    };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
      setLongPressActive(true);
      beginDrag(startX, startY, pointerId);
    }, LONG_PRESS_MS);

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('pointerdown', onSecondPointer);
  };

  // Clean up the timer if the component unmounts mid-press.
  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  const showMobileBar = isMoving || longPressActive;

  // Text blocks shrink-wrap to their content (max-content) but wrap at
  // canvasWidth — so a short line is a small block and the resize handle
  // sits at the real content edge. Databases keep an explicit width.
  const isText = block.type !== 'database';
  return (
    <div
      // data-block-id lets nextStackY() find this element in the DOM so it
      // can read the block's actual rendered height instead of guessing.
      // Without this, batched image uploads stack on top of previously-
      // uploaded images because the 120px text-block estimate badly
      // underestimates a 400–800px photo block's real height.
      data-block-id={block.id}
      style={{
        position: 'absolute',
        left: block.canvasX,
        top: block.canvasY,
        ...(isText
          ? { width: 'max-content', maxWidth: block.canvasWidth }
          : { width: block.canvasWidth }),
        zIndex: isMoving ? 10 : 2,
      }}
      // pointer-events-none on the wrapper means empty space inside the
      // block's rectangle (when it's wider/taller than its content) does
      // NOT intercept clicks — they pass through to blocks behind/below.
      // Interactive children below opt back in with pointer-events-auto.
      // Pointer events still bubble from those children to onPointerDown,
      // so Alt-drag-anywhere keeps working.
      className={`group transition-shadow pointer-events-none ${isMoving ? 'ring-2 ring-accent rounded-lg shadow-xl' : ''}`}
      onPointerDown={handlePointerDown}
    >
      {/* Hover bridge: always-present transparent strip filling the gutter
          between the block and its left handles, so moving the cursor out
          to the handles never crosses a non-hoverable gap (which would drop
          group-hover and make the handles vanish before you reach them).
          Desktop only. */}
      <div
        aria-hidden
        className="pointer-events-auto absolute -left-9 top-0 h-full w-9 hidden md:block [@media(hover:none)]:!hidden"
      />

      {/* Counter-scale factor for handles: at zoom 1.0 they stay normal
          size; as the user zooms OUT, the handles need to render larger in
          canvas-px so they remain a constant size in viewport-px. Capped at
          4x so handles don't become absurd at extreme zoom-out. At zoom > 1
          the original size is fine (handles already feel large enough). */}
      {/* invScale captures the multiplier we apply to canvas-px sizes. */}
      {(() => null)()}
      {/* Desktop hover handles — only on hover-capable devices */}
      <div
        className="pointer-events-auto absolute hidden group-hover:flex flex-col gap-0.5 z-10 [@media(hover:none)]:!hidden"
        style={{
          // Scale the whole desktop handle column up when zoomed out.
          // transform-origin top-right so it grows into the left gutter
          // away from block content.
          transform: `scale(${Math.min(4, Math.max(1, 1 / zoom))})`,
          transformOrigin: 'top right',
          top: 4,
          left: -36,
        }}
      >
        <button
          data-drag-handle
          style={{ touchAction: 'none' }}
          className="p-1 rounded cursor-grab active:cursor-grabbing text-muted hover:text-text hover:bg-surface transition-colors"
          title="Drag to move (or hold Alt and drag anywhere on the block)"
        >
          <GripVertical size={14} />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(block.id)}
          className="p-1 rounded text-muted hover:text-red-500 hover:bg-surface transition-colors"
          title="Delete block (Alt+Delete)"
        >
          <X size={12} />
        </button>
      </div>

      {/* Mobile drag bar — hidden by default so it doesn't intercept
          pinch gestures or clutter every block. Long-press anywhere on
          the block body triggers `showMobileBar`, which fades the bar
          in and starts the drag in the same gesture. Sized in canvas-px
          so the visible height stays constant regardless of zoom. */}
      {(() => {
        const invScale = Math.min(4, Math.max(1, 1 / zoom));
        const barH = 24 * invScale;
        return (
          <div
            data-drag-handle
            style={{
              touchAction: 'none',
              height: barH,
              top: -barH,
            }}
            className={`hidden [@media(hover:none)]:flex absolute left-0 right-0 items-center justify-center z-10 rounded-t-lg transition-opacity duration-150 ${
              showMobileBar
                ? 'opacity-100 pointer-events-auto bg-accent/20'
                : 'opacity-0 pointer-events-none bg-transparent'
            }`}
          >
            <div
              className={`rounded-full transition-colors ${isMoving ? 'bg-accent/70' : 'bg-muted/40'}`}
              style={{ width: 40 * invScale, height: 4 * invScale }}
            />
            {isMoving && (
              <span
                className="absolute text-accent font-medium select-none"
                style={{ left: 8 * invScale, fontSize: 10 * invScale }}
              >
                moving — lift to drop
              </span>
            )}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDelete(block.id)}
              className="absolute rounded text-muted hover:text-red-500 hover:bg-surface"
              style={{ right: 4 * invScale, top: 2 * invScale, padding: 2 * invScale }}
              title="Delete block"
            >
              <X size={14 * invScale} />
            </button>
          </div>
        );
      })()}

      {/* Content wrapper opts back into pointer events and carries hover
          tracking. inline-block so it shrink-wraps content width and the
          hit area never exceeds what's visible. */}
      <div
        className="pointer-events-auto block w-full"
        onMouseEnter={() => onHover(block.id)}
        onMouseLeave={() => onHover(null)}
      >
        {block.type === 'database' ? (
          <div className="relative">
            {/* Databases keep their own border since they're a structured thing.
                When content.height is set, clamp the height and let content scroll.
                Height lives in the content JSON (not a DB column) so it needs no
                schema migration on this project's no-migrate deploy pipeline. */}
            <div
              className="rounded-lg border border-border bg-surface overflow-hidden flex-1 min-w-0"
              style={block.content?.height ? { maxHeight: block.content.height, overflowY: 'auto' } : {}}
            >
              <CanvasDatabaseBlock databaseId={block.content?.databaseId} onSelect={(dbId) => onContentUpdate(block.id, { ...block.content, databaseId: dbId })} />
            </div>
            {/* Bottom-right corner resize handle — visible on hover.
                Counter-scaled so it stays usable at any zoom level. */}
            <div
              data-resize-handle
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const startW = block.canvasWidth;
                const startH = block.content?.height ?? 400;
                const MIN_DB_H = 80;
                const MAX_DB_H = 4000;
                const onMove = (ev: PointerEvent) => {
                  ev.preventDefault();
                  const dx = (ev.clientX - startX) / zoom;
                  const dy = (ev.clientY - startY) / zoom;
                  onResize(block.id, Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, startW + dx)));
                  onResizeHeight?.(block.id, Math.max(MIN_DB_H, Math.min(MAX_DB_H, startH + dy)));
                };
                const onUp = () => {
                  document.removeEventListener('pointermove', onMove);
                  document.removeEventListener('pointerup', onUp);
                  document.removeEventListener('pointercancel', onUp);
                  onResizeEnd(block.id);
                  onResizeHeightEnd?.(block.id);
                };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
              }}
              className="pointer-events-auto absolute bottom-0 right-0 hidden group-hover:block cursor-nwse-resize [@media(hover:none)]:!hidden"
              style={{
                width: 20,
                height: 20,
                transform: `scale(${Math.min(4, Math.max(1, 1 / zoom))})`,
                transformOrigin: 'bottom right',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" className="text-muted hover:text-accent">
                <line x1="14" y1="20" x2="20" y2="14" stroke="currentColor" strokeWidth="1.5" />
                <line x1="10" y1="20" x2="20" y2="10" stroke="currentColor" strokeWidth="1.5" />
                <line x1="6" y1="20" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          </div>
        ) : (
          // Text blocks render flush — no card, no border, no padding.
          // Looks like normal document content.
          <CanvasTextBlock
            blockId={block.id}
            initialContent={block.content}
            zoom={zoom}
            onUpdate={onContentUpdate}
            onEmpty={onBlockEmpty}
            getEditorRef={registerEditor}
            onFocusChange={onFocusChange}
            onImageResize={handleImageResize}
            onImageSelectedChange={handleImageSelectedChange}
            onInsertDatabase={onInsertDatabase}
          />
        )}
      </div>

    </div>
  );
}

// ——— CanvasPageEditor ——————————————————————————————————————————————————————

export function CanvasPageEditor({
  page,
  initialBlocks,
  onDeleted,
}: {
  page: PageData;
  initialBlocks: CanvasBlockData[];
  // When rendered embedded (e.g. a database split-view panel) the host
  // passes this so deleting the page closes the panel instead of
  // navigating the whole app to home.
  onDeleted?: () => void;
}) {
  const router = useRouter();
  // Owner-only features (mood board, YouTube import) hide their buttons for
  // non-owners. The session callback in lib/auth.ts populates `isOwner`.
  const { data: session } = useSession();
  const isOwner = !!(session?.user as any)?.isOwner;
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [favorite, setFavorite] = useState(page.isFavorite);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('saved');
  const [blocks, setBlocks] = useState<CanvasBlockData[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [tiktokOpen, setTiktokOpen] = useState(false);
  const [moodboardOpen, setMoodboardOpen] = useState(false);
  const [newBlockId, setNewBlockId] = useState<string | null>(null);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  // Canvas-level zoom (transform-scale on the inner canvas; not browser zoom).
  // On a phone the document column (720px) is far wider than the viewport,
  // so default to ~0.55 there — it lands roughly fit-to-width instead of
  // opening zoomed into the top-left corner.
  const [zoom, setZoom] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 0.55;
    return 1;
  });
  // Mirror in a ref so pointer/touch handlers always read the live value
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Visible size of the scroll viewport — drives "canvas always fills the
  // window" sizing so zooming out never leaves dead space.
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Track the scroll viewport's visible size so the canvas can always be
  // at least as big as the window (see canvasW/canvasH below).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Drag state: we store the canvas-coord offset between the finger and the
  // block's top-left, then on each move recompute the block position from the
  // current finger screen pos + current scroll + zoom. This naturally handles
  // auto-scrolling — when the canvas scrolls under a stationary finger, the
  // block's canvas position is recomputed and follows.
  const dragState = useRef<{
    blockId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRefs = useRef<Record<string, any>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // Track which block is "active" for keyboard shortcuts (Alt+Delete)
  const hoveredBlockRef = useRef<string | null>(null);
  const focusedBlockRef = useRef<string | null>(null);
  // Most-recently-focused block; survives blur so the shared toolbar still
  // knows which editor to act on after focus flickers.
  const lastFocusedId = useRef<string | null>(null);
  // Editor captured when the font <select> is opened (it blurs the editor)
  const fontTargetEditor = useRef<any>(null);
  // Track if we've already migrated this page so we don't re-migrate on re-render
  const migratedRef = useRef(false);

  // ── Bootstrap: auto-migrate old single-document block ─────────────────
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;

    const hasOldDoc =
      initialBlocks.length === 1 && initialBlocks[0].type === 'document';

    if (!hasOldDoc && initialBlocks.length > 0) {
      setBlocks(initialBlocks);
      return;
    }

    if (!hasOldDoc && initialBlocks.length === 0) {
      // New empty page — create one starter block at the doc column
      createBlock(DOC_X, 60, DOC_W_TEXT);
      return;
    }

    // Migrate old TipTap document to canvas blocks
    const oldBlock = initialBlocks[0];
    const converted = docToCanvasBlocks(oldBlock.content);

    if (converted.length === 0) {
      // Empty doc
      createBlock(DOC_X, 60, DOC_W_TEXT);
      fetch(`/api/blocks/${oldBlock.id}`, { method: 'DELETE' }).catch(() => {});
      return;
    }

    // POST each converted block, then delete the old one
    Promise.all(
      converted.map((b) =>
        fetch('/api/blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: page.id, ...b }),
        }).then((r) => r.json())
      )
    ).then((created) => {
      setBlocks(created);
      fetch(`/api/blocks/${oldBlock.id}`, { method: 'DELETE' }).catch(() => {});
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute the next vertical slot below all existing blocks ──────────
  // Where to drop the next new block — far enough below existing content
  // that no overlap can occur. Reads each block's ACTUAL rendered height
  // from the DOM when available (via data-block-id), falling back to a
  // type-aware estimate for blocks that haven't laid out yet. The DOM
  // read is what makes batched image uploads stack cleanly below previous
  // images: a fixed 120px estimate would put a new batch on top of a
  // previous 600px-tall photo block, and the later-mounted block paints
  // on top of (and steals pointer events from) the older one.
  const nextStackY = useCallback(() => {
    if (blocks.length === 0) return 60;
    let maxBottom = 0;
    for (const b of blocks) {
      let bottom: number;
      const el =
        innerRef.current?.querySelector(`[data-block-id="${b.id}"]`) as
          | HTMLElement
          | null;
      if (el && el.offsetHeight > 0) {
        // offsetHeight is the layout (pre-transform) height in canvas pixels,
        // which is exactly what we want for canvasY math.
        bottom = b.canvasY + el.offsetHeight;
      } else {
        // Block not yet in the DOM (just created and React hasn't committed).
        // Fall back to a content-aware estimate so the spacing isn't wildly
        // wrong on first paint.
        const isImage =
          b.content?.type === 'doc' &&
          b.content?.content?.length === 1 &&
          b.content?.content?.[0]?.type === 'image';
        const estimate =
          b.type === 'database' ? 440 : isImage ? 600 : 120;
        bottom = b.canvasY + estimate;
      }
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return maxBottom + BLOCK_GAP;
  }, [blocks]);

  // ── Block creation ─────────────────────────────────────────────────────
  const createBlock = useCallback(
    async (x: number, y: number, width = DOC_W_TEXT, type = 'text', content?: any) => {
      const body = {
        pageId: page.id,
        type,
        content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
        canvasX: x,
        canvasY: y,
        canvasWidth: width,
        position: Date.now(),
      };
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const created = await res.json();
      setBlocks((prev) => [...prev, created]);
      setNewBlockId(created.id);
      return created;
    },
    [page.id]
  );

  // ── Drag (document-level listeners + auto-scroll near edges) ──────────
  const startDrag = useCallback(
    (blockId: string, fingerCX: number, fingerCY: number, blockX: number, blockY: number, _pointerId: number) => {
      const sc = scrollRef.current;
      if (!sc) return;
      // If we're already in a pinch (rare — usually the second touch lands
      // after pointerdown), don't even arm a drag.
      if (isPinchingRef.current) return;

      const rect = sc.getBoundingClientRect();
      const z = zoomRef.current;
      // Canvas coord of the finger at drag start
      const fingerCanvasX = (fingerCX - rect.left + sc.scrollLeft) / z;
      const fingerCanvasY = (fingerCY - rect.top + sc.scrollTop) / z;
      // Offset = where on the block the finger landed (canvas coords)
      const offsetX = blockX - fingerCanvasX;
      const offsetY = blockY - fingerCanvasY;

      // Movement threshold (squared, in screen pixels) before we treat this
      // as an actual drag. Until the finger moves past this, no block
      // motion happens and a second finger (pinch) can cleanly take over.
      // 7px is small enough not to feel laggy, big enough to absorb the
      // ~3-5px wobble of a second finger landing during a pinch.
      const MOVE_THRESHOLD_SQ = 7 * 7;
      let dragActive = false;
      // Last known screen position — used by pointermove and the auto-scroll RAF loop
      let lastClientX = fingerCX;
      let lastClientY = fingerCY;

      const repositionBlock = () => {
        if (!dragState.current) return;
        const sc2 = scrollRef.current;
        if (!sc2) return;
        const r = sc2.getBoundingClientRect();
        const zz = zoomRef.current;
        const fcx = (lastClientX - r.left + sc2.scrollLeft) / zz;
        const fcy = (lastClientY - r.top + sc2.scrollTop) / zz;
        const nx = Math.max(0, fcx + dragState.current.offsetX);
        const ny = Math.max(0, fcy + dragState.current.offsetY);
        const id = dragState.current.blockId;
        setBlocks((prev) =>
          prev.map((b) => (b.id === id ? { ...b, canvasX: nx, canvasY: ny } : b))
        );
      };

      // Auto-scroll loop: while finger is near a scroll-container edge, scroll
      // toward it on every frame so the user can drag past the viewport.
      const AUTOSCROLL_MARGIN = 60;
      const AUTOSCROLL_MAX_SPEED = 14;
      let rafId = 0;
      const tick = () => {
        if (!dragState.current) return;
        const sc2 = scrollRef.current;
        if (!sc2) return;
        const r = sc2.getBoundingClientRect();
        const proximity = (dist: number) =>
          Math.min(AUTOSCROLL_MAX_SPEED, Math.max(0, AUTOSCROLL_MARGIN - dist) * (AUTOSCROLL_MAX_SPEED / AUTOSCROLL_MARGIN));
        let dx = 0;
        let dy = 0;
        if (lastClientX - r.left < AUTOSCROLL_MARGIN) dx = -proximity(lastClientX - r.left);
        else if (r.right - lastClientX < AUTOSCROLL_MARGIN) dx = proximity(r.right - lastClientX);
        if (lastClientY - r.top < AUTOSCROLL_MARGIN) dy = -proximity(lastClientY - r.top);
        else if (r.bottom - lastClientY < AUTOSCROLL_MARGIN) dy = proximity(r.bottom - lastClientY);
        if (dx !== 0 || dy !== 0) {
          sc2.scrollBy({ left: dx, top: dy });
          repositionBlock();
        }
        rafId = requestAnimationFrame(tick);
      };

      // First real move past the threshold "commits" the drag: stores the
      // drag state, highlights the block, vibrates, kicks off the
      // auto-scroll RAF loop. Until this fires, a pinch can still take over.
      const commitDrag = () => {
        if (dragActive) return;
        dragActive = true;
        dragState.current = { blockId, offsetX, offsetY };
        setMovingBlockId(blockId);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        rafId = requestAnimationFrame(tick);
      };

      const onPointerMove = (e: PointerEvent) => {
        // If a pinch started after we armed the drag, give up — the pinch
        // handler has already called our cancelDragRef, so this is just a
        // safety net for late pointermove events.
        if (isPinchingRef.current) return;
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        if (!dragActive) {
          const dx = e.clientX - fingerCX;
          const dy = e.clientY - fingerCY;
          if (dx * dx + dy * dy < MOVE_THRESHOLD_SQ) return;
          commitDrag();
        }
        repositionBlock();
        if (e.cancelable) e.preventDefault();
      };

      const teardown = () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerEnd);
        document.removeEventListener('pointercancel', onPointerEnd);
        cancelDragRef.current = null;
      };

      const onPointerEnd = () => {
        teardown();
        if (!dragState.current) return;
        const id = dragState.current.blockId;
        dragState.current = null;
        setMovingBlockId(null);
        setBlocks((prev) => {
          const b = prev.find((x) => x.id === id);
          if (b) {
            fetch(`/api/blocks/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ canvasX: b.canvasX, canvasY: b.canvasY }),
            }).catch(() => {});
          }
          return prev;
        });
      };

      // Hand the pinch handler a way to abort us cleanly. If a second
      // finger lands before we commit (the common case), this runs and
      // nothing has moved yet. If it lands after we commit, the block
      // freezes wherever it currently is.
      cancelDragRef.current = () => {
        teardown();
        if (dragState.current) {
          dragState.current = null;
          setMovingBlockId(null);
        }
      };

      // Passive: false so preventDefault() actually works on touch
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerEnd);
      document.addEventListener('pointercancel', onPointerEnd);
    },
    []
  );

  // ── Click empty canvas to create block ────────────────────────────────
  //
  // Tracks the pointer-down state so the click handler can distinguish
  // a real "tap to add a block" from:
  //   - a long press (user just resting their finger / cursor)
  //   - a drag (user trying to pan, or aborted move)
  // Without this, holding the canvas for half a second OR clicking-and-
  // dragging both end up creating an unwanted text block.
  const clickGuardRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const CLICK_MAX_MS = 400;   // anything held longer is a press, not a tap
  const CLICK_MAX_DELTA = 6;  // pixels — wobble allowance; more = a drag

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== innerRef.current) return;
    clickGuardRef.current = { t: Date.now(), x: e.clientX, y: e.clientY };
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragState.current) return;
      if (e.target !== innerRef.current) return; // only on blank canvas

      // Apply tap-vs-press/drag gating. The guard is set on pointerdown
      // by handleCanvasPointerDown; if it's missing the click came from
      // a synthetic source (keyboard, accessibility tools) — fall back
      // to the simple "create block" behavior in that case.
      const guard = clickGuardRef.current;
      clickGuardRef.current = null;
      if (guard) {
        const elapsed = Date.now() - guard.t;
        const dx = e.clientX - guard.x;
        const dy = e.clientY - guard.y;
        if (elapsed > CLICK_MAX_MS || dx * dx + dy * dy > CLICK_MAX_DELTA * CLICK_MAX_DELTA) {
          return; // long press or drag — user didn't ask for a block
        }
      }

      const rect = innerRef.current!.getBoundingClientRect();
      const z = zoomRef.current;
      const x = (e.clientX - rect.left) / z;
      const y = (e.clientY - rect.top) / z;
      createBlock(x, y);
    },
    [createBlock]
  );

  // ── Block content save ─────────────────────────────────────────────────
  const handleContentUpdate = useCallback((id: string, content: any) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, content } : b)));
    fetch(`/api/blocks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(() => {});
  }, []);

  // ── Delete block ───────────────────────────────────────────────────────
  const handleDeleteBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    fetch(`/api/blocks/${id}`, { method: 'DELETE' }).catch(() => {});
    if (hoveredBlockRef.current === id) hoveredBlockRef.current = null;
    if (focusedBlockRef.current === id) focusedBlockRef.current = null;
  }, []);

  // ── Hover/focus tracking for Alt+Delete ───────────────────────────────
  const handleHover = useCallback((id: string | null) => {
    hoveredBlockRef.current = id;
  }, []);
  const handleFocusChange = useCallback((id: string | null) => {
    focusedBlockRef.current = id;
    // Sticky target for the shared formatting toolbar: only advances when a
    // different block is focused, never cleared on blur. Without this the
    // toolbar dies the instant focus flickers (e.g. clicking the toolbar,
    // opening a dialog, mobile keyboard).
    if (id) lastFocusedId.current = id;
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────
  const handleResize = useCallback((id: string, width: number) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, canvasWidth: width } : b)));
  }, []);
  const handleResizeEnd = useCallback((id: string) => {
    setBlocks((prev) => {
      const b = prev.find((x) => x.id === id);
      if (b) {
        fetch(`/api/blocks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasWidth: b.canvasWidth }),
        }).catch(() => {});
      }
      return prev;
    });
  }, []);

  // Database-block height lives in the block's content JSON (content.height),
  // not a dedicated column — this project's deploy never runs migrations, so a
  // new column would 500 every block query against the un-migrated DB.
  const handleResizeHeight = useCallback((id: string, height: number) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, content: { ...b.content, height } } : b)));
  }, []);
  const handleResizeHeightEnd = useCallback((id: string) => {
    setBlocks((prev) => {
      const b = prev.find((x) => x.id === id);
      if (b) {
        fetch(`/api/blocks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: b.content }),
        }).catch(() => {});
      }
      return prev;
    });
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  // Refs to avoid re-registering the listener when canvasW/H change during animation.
  const fitToScreenAnimatedRef = useRef<(() => void) | null>(null);
  const animateZoomRef = useRef<((z: number, x: number, y: number, d?: number) => void) | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      // Skip if focused inside an input, textarea, or contenteditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
      // Don't intercept when modals are likely open
      if ((e.target as HTMLElement)?.closest?.('[role="dialog"]')) return;

      // Alt+Delete — delete the focused or hovered block
      if (e.altKey && e.key === 'Delete') {
        const target = focusedBlockRef.current || hoveredBlockRef.current;
        if (!target) return;
        e.preventDefault();
        handleDeleteBlock(target);
        return;
      }

      // No modifier — zoom shortcuts
      if (!e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === '0') {
          e.preventDefault();
          fitToScreenAnimatedRef.current?.();
          return;
        }
        if (e.key === '1') {
          e.preventDefault();
          const el = scrollRef.current;
          if (el) {
            const z = zoomRef.current;
            const cx = (el.scrollLeft + el.clientWidth / 2) / z;
            const cy = (el.scrollTop + el.clientHeight / 2) / z;
            const tx = cx * 1 - el.clientWidth / 2;
            const ty = cy * 1 - el.clientHeight / 2;
            animateZoomRef.current?.(1, Math.max(0, tx), Math.max(0, ty));
          }
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteBlock]);

  // ── Editor ref registry (for summarize/organize) ──────────────────────
  const registerEditor = useCallback((id: string, editor: any) => {
    editorRefs.current[id] = editor;
  }, []);

  // Run a TipTap command on whichever block currently has focus.
  // Uses onMouseDown + preventDefault on the calling button so focus stays put.
  const runOnFocused = useCallback((fn: (editor: any) => void) => {
    const id = focusedBlockRef.current ?? lastFocusedId.current;
    if (!id) return;
    const ed = editorRefs.current[id];
    if (ed) fn(ed);
  }, []);

  const getAllText = () =>
    blocks
      .filter((b) => b.type === 'text')
      .map((b) => {
        const extract = (node: any): string => {
          if (node.type === 'text') return node.text ?? '';
          return (node.content ?? []).map(extract).join('\n');
        };
        return extract(b.content);
      })
      .join('\n\n');

  // ── Page metadata saves ───────────────────────────────────────────────
  const saveMeta = useCallback(
    async (data: Record<string, any>, refresh = false) => {
      setSavingState('saving');
      await fetch(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setSavingState('saved');
      if (refresh) router.refresh();
    },
    [page.id, router]
  );

  useEffect(() => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => saveMeta({ title }), 800);
    return () => { if (titleTimer.current) clearTimeout(titleTimer.current); };
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    await saveMeta({ isFavorite: next }, true);
  };

  const changeIcon = async () => {
    const next = await promptDialog({
      title: 'Page icon', message: 'Enter an emoji (or leave blank to clear).',
      defaultValue: icon ?? '📄', placeholder: '📄',
    });
    if (next !== null) {
      setIcon(next || null);
      await saveMeta({ icon: next || null }, true);
    }
  };

  const deletePage = async () => {
    // Soft-delete + undo toast rather than a no-going-back confirm.
    const res = await fetch(`/api/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true }),
    });
    if (!res.ok) { toast.error('Failed to delete page'); return; }
    const embedded = typeof onDeleted === 'function';
    const restore = async () => {
      await fetch(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: false }),
      });
      window.dispatchEvent(new Event('kove:refresh-tree'));
      if (!embedded) { router.push(`/page/${page.id}`); router.refresh(); }
    };
    toast.undo(`Deleted "${title || 'Untitled'}"`, restore);
    // Tell the sidebar to refetch — router.refresh() alone doesn't re-run
    // the Sidebar's client-side page fetch, so the deleted page would
    // otherwise linger in the tree.
    window.dispatchEvent(new Event('kove:refresh-tree'));
    if (embedded) {
      // Embedded (e.g. database split view): close the panel, stay put.
      onDeleted!();
    } else {
      router.push('/');
      router.refresh();
    }
  };

  // ── Add a database embed block (stacked below existing content) ───────
  const addDatabaseBlock = () => {
    createBlock(DOC_X, nextStackY(), DOC_W_DB, 'database', { databaseId: null, height: 400 });
  };

  // ── Canvas size — grows with content AND always fills the viewport ────
  // The canvas is rendered at scale(zoom). If we only sized it to the
  // content, zooming out would leave the visible area larger than the
  // usable canvas (dead, unclickable space). So the canvas is at least
  // big enough that, at the current zoom, it covers the whole scroll
  // viewport — the entire window is always usable.
  const contentW = Math.max(900, ...blocks.map((b) => b.canvasX + b.canvasWidth + 80));
  const contentH = Math.max(600, ...blocks.map((b) => b.canvasY + 400));
  const z = zoom || 1;
  const canvasW = Math.max(contentW, viewport.w > 0 ? Math.ceil(viewport.w / z) : contentW);
  const canvasH = Math.max(contentH, viewport.h > 0 ? Math.ceil(viewport.h / z) : contentH);

  // ── Canvas zoom: alt/ctrl/⌘ + wheel (desktop) and pinch (touch) ───────
  // These must be NON-PASSIVE native listeners — React attaches wheel/touch
  // passively, so e.preventDefault() there can't stop the browser's own
  // page zoom (ctrl/⌘+wheel, trackpad pinch) or pinch-zoom. Attaching them
  // natively lets us swallow the gesture and zoom only the note canvas.
  // Pinch state — also stores the LOCKED focal point in canvas coords
  // (canvasMidX/Y) and the screen-space midpoint at gesture start so the
  // zoom can pivot around the same canvas point even if fingers wobble
  // slightly between touchmove events. Without this lock the focal point
  // chases the midpoint and creates a "drift" you can see while pinching.
  const pinchRef = useRef<{
    initialDist: number;
    initialZoom: number;
    canvasFocalX: number;
    canvasFocalY: number;
    screenFocalX: number;
    screenFocalY: number;
  } | null>(null);
  // Wheel state — same idea as pinch, but bursts of wheel events don't
  // have a natural "start"/"end" so we treat any pause of >200ms as the
  // end of a gesture and capture a fresh focal point on the next event.
  const wheelFocalRef = useRef<{
    canvasX: number;
    canvasY: number;
    screenX: number;
    screenY: number;
    lastTime: number;
  } | null>(null);
  // Lets the drag handler bail when a pinch is active so we don't move a
  // block while the user is just trying to zoom near it.
  const isPinchingRef = useRef(false);
  // The drag handler stores a cancel-fn here so the pinch handler can
  // abort an accidentally-started drag the moment a second finger lands.
  const cancelDragRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Effectively-infinite zoom. We clamp to extremely wide bounds rather
    // than truly unbounded so a runaway gesture can't park the canvas at
    // zoom=0 (invisible, hard to recover from) or zoom=1000 (single block
    // takes 100k pixels of scroll). 0.05 = 1/20th, 20x = 20× — past these
    // the canvas is no longer usable in any practical way.
    const CLAMP = (z: number) => Math.max(0.05, Math.min(20, z));

    const FOCAL_RESET_MS = 200;
    const onWheel = (e: WheelEvent) => {
      if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const sc = scrollRef.current;
      if (!sc) return;

      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const oldZoom = zoomRef.current;
      const newZoom = +CLAMP(oldZoom * factor).toFixed(3);
      if (newZoom === oldZoom) return;

      const now = Date.now();
      const rect = sc.getBoundingClientRect();

      // Lock the focal point on the FIRST event of a burst (or any time
      // there's been >200ms of idle) and reuse it for the burst. Without
      // this, every wheel tick reads the cursor's current position — so
      // tiny mouse drift between ticks shifts the focal point and the
      // canvas "chases" the cursor. With locking, the user can scroll
      // freely and the zoom anchors exactly where they aimed it.
      const f = wheelFocalRef.current;
      if (!f || now - f.lastTime > FOCAL_RESET_MS) {
        wheelFocalRef.current = {
          canvasX: (e.clientX - rect.left + sc.scrollLeft) / oldZoom,
          canvasY: (e.clientY - rect.top + sc.scrollTop) / oldZoom,
          screenX: e.clientX,
          screenY: e.clientY,
          lastTime: now,
        };
      } else {
        f.lastTime = now;
      }
      const focal = wheelFocalRef.current!;

      flushSync(() => setZoom(newZoom));
      sc.scrollLeft = focal.canvasX * newZoom - (focal.screenX - rect.left);
      sc.scrollTop = focal.canvasY * newZoom - (focal.screenY - rect.top);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const sc = scrollRef.current;
      if (!sc) return;
      isPinchingRef.current = true;
      // Cancel any in-progress single-finger drag that started on the
      // first finger before the second arrived.
      if (cancelDragRef.current) cancelDragRef.current();

      const [a, b] = [e.touches[0], e.touches[1]];
      const initialZoom = zoomRef.current;
      // Lock the focal point at the midpoint of the initial two-finger
      // touchdown. The pinch will pivot around THIS canvas point for the
      // entire gesture, even if the fingers wobble. Recomputing the
      // midpoint on each touchmove (the previous behavior) caused tiny
      // finger drift to shift the focal point and made the canvas jitter
      // as the user pinched.
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const rect = sc.getBoundingClientRect();
      pinchRef.current = {
        initialDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        initialZoom,
        canvasFocalX: (midX - rect.left + sc.scrollLeft) / initialZoom,
        canvasFocalY: (midY - rect.top + sc.scrollTop) / initialZoom,
        screenFocalX: midX,
        screenFocalY: midY,
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const sc = scrollRef.current;
      if (!sc) return;

      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const p = pinchRef.current;
      const newZoom = +CLAMP(p.initialZoom * (dist / p.initialDist)).toFixed(3);
      if (newZoom === zoomRef.current) return;

      // Pivot around the LOCKED focal point captured at touchstart.
      // canvasFocal{X,Y} is the canvas-space point the user originally
      // grabbed; screenFocal{X,Y} is where it should stay on screen.
      const rect = sc.getBoundingClientRect();

      // flushSync forces React to commit the zoom change so the scroll
      // container's content size has updated before we set scrollLeft.
      // Without it our scroll math runs against stale dimensions and the
      // viewport jumps toward top-left for the first event of a gesture.
      flushSync(() => setZoom(newZoom));
      sc.scrollLeft = p.canvasFocalX * newZoom - (p.screenFocalX - rect.left);
      sc.scrollTop = p.canvasFocalY * newZoom - (p.screenFocalY - rect.top);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length === 0) {
        // Brief grace period before re-allowing drags — sometimes a
        // pointermove arrives just after the last touchend and would
        // otherwise jolt a block.
        setTimeout(() => { isPinchingRef.current = false; }, 120);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const fitToScreen = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fitX = el.clientWidth / canvasW;
    const fitY = el.clientHeight / canvasH;
    setZoom(Math.max(0.05, Math.min(1, Math.min(fitX, fitY))));
  }, [canvasW, canvasH]);

  const stepZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(0.05, Math.min(20, +(z + delta).toFixed(2))));
  }, []);

  // ── Animated zoom helper — interpolates zoom + scroll together ─────────
  // Uses rAF with ease-in-out quad easing over ~280ms so the transition
  // feels smooth but snappy (Canva-style).
  const animRef = useRef<number | null>(null);
  const animateZoom = useCallback((targetZoom: number, targetScrollX: number, targetScrollY: number, duration = 280) => {
    const el = scrollRef.current;
    if (!el) return;
    // Cancel any in-progress animation
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);

    const startZoom = zoomRef.current;
    const startScrollX = el.scrollLeft;
    const startScrollY = el.scrollTop;
    const startTime = performance.now();

    const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeInOutQuad(progress);

      flushSync(() => setZoom(+((startZoom + (targetZoom - startZoom) * eased).toFixed(3))));
      el.scrollLeft = startScrollX + (targetScrollX - startScrollX) * eased;
      el.scrollTop = startScrollY + (targetScrollY - startScrollY) * eased;

      if (progress < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(step);
  }, []);

  // Zoom to 100% centered on a specific block — used by double-tap on touch.
  const focusOnBlock = useCallback((block: CanvasBlockData) => {
    const el = scrollRef.current;
    if (!el) return;
    const targetZoom = 1;
    const blockCenterX = block.canvasX + block.canvasWidth / 2;
    const blockCenterY = block.canvasY + 200; // approximate block visual center
    const tx = blockCenterX * targetZoom - el.clientWidth / 2;
    const ty = blockCenterY * targetZoom - el.clientHeight / 2;
    animateZoom(targetZoom, Math.max(0, tx), Math.max(0, ty));
  }, [animateZoom]);

  // Animated fit-to-screen — same as fitToScreen but smooth.
  const fitToScreenAnimated = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fitX = el.clientWidth / canvasW;
    const fitY = el.clientHeight / canvasH;
    const targetZoom = Math.max(0.05, Math.min(1, Math.min(fitX, fitY)));
    animateZoom(targetZoom, 0, 0);
  }, [canvasW, canvasH, animateZoom]);

  fitToScreenAnimatedRef.current = fitToScreenAnimated;
  animateZoomRef.current = animateZoom;

  // ── Handle "organize" result: replace all text blocks ─────────────────
  const handleOrganize = (html: string) => {
    // Parse the HTML into a TipTap-compatible doc via a temporary div
    // For now, replace all text blocks with one big text block containing the organized HTML
    const firstText = blocks.find((b) => b.type === 'text');
    if (firstText) {
      // We'll set the first text block's content to the organized HTML string
      // TipTap can ingest HTML via setContent
      editorRefs.current[firstText.id]?.commands.setContent(html);
      handleContentUpdate(firstText.id, editorRefs.current[firstText.id]?.getJSON());
    }
  };

  // ── Handle YouTube / TikTok transcript import ─────────────────────────
  const insertTranscriptBlock = (title: string, text: string, emoji: string) => {
    const words = text.split(/\s+/);
    const PARA_SIZE = 150;
    const paragraphs: any[] = [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `${emoji} ${title}` }],
      },
    ];
    for (let i = 0; i < words.length; i += PARA_SIZE) {
      const chunk = words.slice(i, i + PARA_SIZE).join(' ');
      if (chunk) {
        paragraphs.push({ type: 'paragraph', content: [{ type: 'text', text: chunk }] });
      }
    }
    createBlock(DOC_X, nextStackY(), DOC_W_TEXT, 'text', {
      type: 'doc',
      content: paragraphs,
    });
  };
  const handleYouTubeImport = ({ title, text }: { title: string; text: string }) =>
    insertTranscriptBlock(title, text, '📺');
  const handleTikTokImport = ({ title, text }: { title: string; text: string }) =>
    insertTranscriptBlock(title, text, '🎵');

  // ── Image upload ───────────────────────────────────────────────────────
  // Accepts one or many files. Each image becomes its own block, stacked
  // vertically below existing content. Three phases:
  //
  //   1. PRE-FLIGHT: decode each File locally + upload to R2 in parallel.
  //   2. PERSIST: POST every block to /api/blocks in parallel.
  //   3. COMMIT: a SINGLE setBlocks call with all the new blocks at once.
  //
  // The single-setBlocks commit is the load-bearing detail. The previous
  // versions called the per-block `createBlock` from inside each upload's
  // async closure, so React received N separate setBlocks updates across
  // N different ticks — and empirically that produced blocks that mostly
  // failed to wire up their pointer handlers. Even calling all N
  // createBlocks back-to-back in a synchronous forEach didn't help,
  // because createBlock awaits its own API roundtrip before calling
  // setBlocks. Doing the API calls in parallel and committing once with
  // the full set makes the multi-upload mount behave identically to a
  // single upload, just with N entries instead of one.
  const uploadImages = useCallback(async (files: File[] | FileList) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;

    const RENDER_W_CAP = 600;
    // 120px gap = prose-base's ~64px of vertical margin around images plus
    // a 56px buffer so neighbouring blocks' content wrappers don't even
    // graze each other. Previous 80px allowance worked for landscape but
    // failed for portrait photos where edge-of-image to edge-of-image is
    // already tight at base spacing.
    const VERTICAL_PAD = 120;

    // Phase 1: decode dims + upload bytes (parallel).
    type UploadOk = { url: string; w: number; h: number };
    const uploads = await Promise.all(
      arr.map(async (file): Promise<UploadOk | null> => {
        try {
          const dims = await new Promise<{ w: number; h: number }>((resolve) => {
            const objUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
              URL.revokeObjectURL(objUrl);
              resolve({ w: img.naturalWidth, h: img.naturalHeight });
            };
            img.onerror = () => {
              URL.revokeObjectURL(objUrl);
              resolve({ w: RENDER_W_CAP, h: 400 });
            };
            img.src = objUrl;
          });
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type }),
          });
          if (!res.ok) return null;
          const { uploadUrl, publicUrl } = await res.json();
          await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
          return { url: publicUrl, w: dims.w, h: dims.h };
        } catch {
          return null;
        }
      })
    );

    // Walk Y forward using projected rendered heights so no two blocks
    // overlap. Width clamps to RENDER_W_CAP; height follows the natural
    // aspect ratio — same math as ResizableImage's first-load auto-size.
    const startY = nextStackY();
    let cursor = startY;
    const positions = uploads.map((u) => {
      if (!u) return null;
      const renderW = Math.min(u.w, RENDER_W_CAP);
      const renderH = (u.h / u.w) * renderW;
      const y = cursor;
      cursor += renderH + VERTICAL_PAD;
      return y;
    });

    // Phase 2: POST every block to /api/blocks in parallel. Each block
    // gets a unique `position` (Date.now() + index) so the server doesn't
    // see a collision when this batch lands in the same millisecond.
    const now = Date.now();
    const created = await Promise.all(
      uploads.map(async (u, i) => {
        if (!u || positions[i] === null) return null;
        try {
          const body = {
            pageId: page.id,
            type: 'text',
            content: {
              type: 'doc',
              content: [{ type: 'image', attrs: { src: u.url, width: null } }],
            },
            canvasX: DOC_X,
            canvasY: positions[i] as number,
            canvasWidth: DOC_W_TEXT,
            position: now + i,
          };
          const res = await fetch('/api/blocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
    );

    // Phase 3: single commit. Functional setState appends all the new
    // blocks atomically; React then does ONE reconciliation pass mounting
    // every new CanvasCard together, same as it would for a single block.
    const validNew = created.filter((b): b is CanvasBlockData => b !== null);
    if (validNew.length === 0) return;
    setBlocks((prev) => [...prev, ...validNew]);
  }, [nextStackY, page.id]);

  // ── Pinterest popup ───────────────────────────────────────────────────
  // Opens pinterest.com/search/pins/?q=<term> in a sized popup so the user
  // can browse Pinterest with its actual UI side-by-side with their note.
  // Pinterest blocks iframe embedding via X-Frame-Options:DENY so a real
  // popup window is the only legitimate way to do this. The user then
  // right-clicks any pin → Copy Image and pastes back into the note,
  // which our paste handler below catches and uploads to R2.
  const openPinterest = useCallback(async () => {
    const term = await promptDialog({
      title: 'Browse Pinterest',
      message:
        'Pinterest opens in a popup window. In the popup, right-click any pin → "Copy Image", then come back here and press Cmd+V (or Ctrl+V) to drop it into your note.',
      defaultValue: '',
      placeholder: 'e.g. mid-century modern living room',
    });
    if (term === null) return;
    const q = term.trim();
    if (!q) return;
    const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`;
    const popup = window.open(
      url,
      'pinterest-browse',
      'width=1000,height=720,resizable=yes,scrollbars=yes'
    );
    if (!popup) {
      toast.error('Popup blocked. Allow popups for this site to browse Pinterest.');
      return;
    }
    toast.success('Pinterest opened. Right-click a pin → Copy Image, then paste here.');
  }, []);

  // ── Clipboard image paste ─────────────────────────────────────────────
  // When the user pastes (Cmd/Ctrl+V) and the clipboard contains an image
  // (from Pinterest's "Copy Image", a screenshot, anywhere), drop a new
  // image block on the canvas instead of letting the text-block default
  // paste mangle the binary data into junk text.
  //
  // Capture phase + stopPropagation ensures we win over TipTap's
  // contenteditable paste handler that would otherwise run first.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      // Some apps (e.g. file managers, slide editors) put multiple image
      // items on the clipboard in a single copy. Grab them all, not just
      // the first — otherwise pasting a 10-image clipboard silently drops 9.
      const imageFiles = Array.from(e.clipboardData.items)
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length === 0) return; // no images — let normal text paste run

      e.preventDefault();
      e.stopPropagation();
      try {
        await uploadImages(imageFiles);
        toast.success(
          imageFiles.length === 1
            ? 'Image added to your note.'
            : `${imageFiles.length} images added to your note.`
        );
      } catch {
        toast.error(
          imageFiles.length === 1
            ? 'Could not save the pasted image.'
            : 'Could not save the pasted images.'
        );
      }
    };
    // Capture phase so we beat TipTap's editor-level paste handler.
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [uploadImages]);

  // ── Book Info: AI summary + PDF search link ───────────────────────────
  const handleBookSummary = async () => {
    const author = await promptDialog({
      title: 'Book Info',
      message: 'Enter the author (optional — leave blank to search by title only).',
      placeholder: 'e.g. James Clear',
      defaultValue: '',
    });
    if (author === null) return; // user cancelled

    const toastId = toast.loading('Generating book summary…');
    try {
      const res = await fetch('/api/book-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), author: author.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Request failed');
      }
      const data = await res.json();

      // Build content: summary + PDF link
      const summaryHtml = data.summary || '';
      const pdfLink = data.pdfSearchUrl || '';
      const html = summaryHtml
        + `<p></p>`
        + `<p><a href="${pdfLink}" target="_blank" rel="noopener noreferrer"><strong>Search for PDF →</strong></a></p>`;

      // Insert as a new text block at the top of the doc column
      const block = await createBlock(DOC_X, 60, DOC_W_TEXT, 'text', {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '(Loading…)' }] }],
      });
      setTimeout(() => {
        const ed = editorRefs.current[block.id];
        if (ed) {
          ed.commands.setContent(html);
          handleContentUpdate(block.id, ed.getJSON());
        }
      }, 200);
      toast.dismiss(toastId);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err.message || 'Failed to generate book summary');
    }
  };

  // ── Handle summarize insert ────────────────────────────────────────────
  const handleSummarizeInsert = async (html: string) => {
    // Insert a new text block at top of the doc column
    const block = await createBlock(DOC_X, 60, DOC_W_TEXT, 'text', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '(Summary)' }] }],
    });
    // Set its content to the summary HTML after it mounts
    setTimeout(() => {
      editorRefs.current[block.id]?.commands.setContent(html);
      handleContentUpdate(block.id, editorRefs.current[block.id]?.getJSON());
    }, 200);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={changeIcon} className="text-2xl hover:bg-bg rounded p-1 transition" title="Change icon">
            {icon ?? '📄'}
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            className="text-lg font-semibold bg-transparent outline-none placeholder:text-muted/40 min-w-0 w-48 md:w-72"
          />
          <span className="text-xs text-muted ml-2">
            {savingState === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Block-type buttons */}
          <button
            onClick={() => createBlock(DOC_X, nextStackY(), DOC_W_TEXT)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
          >
            <Plus size={12} /> Text
          </button>
          <button
            onClick={addDatabaseBlock}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
          >
            <Database size={12} /> Database
          </button>
          <div className="w-px bg-border self-stretch mx-0.5" />
          <button
            onClick={() => setRecordOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 transition ${
              recordOpen ? 'bg-red-500/10 border-red-400 text-red-500' : 'border-border hover:bg-bg'
            }`}
          >
            <Mic size={12} /> Record
          </button>
          <button
            onClick={handleBookSummary}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
            title="Generate a summary of this book and a PDF search link"
          >
            <BookOpen size={12} /> Book Info
          </button>
          <button
            onClick={() => setSummarizeOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
          >
            <ClipboardList size={12} /> Summarize
          </button>
          {isOwner && (
            <button
              onClick={() => setYoutubeOpen(true)}
              className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
              title="Import a YouTube video's transcript"
            >
              <Youtube size={12} className="text-red-500" /> YouTube
            </button>
          )}
          <button
            onClick={() => setTiktokOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
            title="Import a TikTok video's transcript (only works if the video has captions)"
          >
            <Music2 size={12} className="text-pink-500" /> TikTok
          </button>
          <button
            onClick={() => setOrganizeOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
          >
            <Sparkles size={12} /> Organize
          </button>
          {isOwner && (
            <button
              onClick={() => setMoodboardOpen(true)}
              className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
              title="Search Unsplash and drop curated images onto this canvas"
            >
              <Palette size={12} /> Mood board
            </button>
          )}
          <button
            onClick={openPinterest}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
            title="Browse Pinterest in a popup. Right-click a pin → Copy Image, then paste here."
          >
            <Pin size={12} className="text-red-500" /> Pinterest
          </button>
          <div className="w-px bg-border self-stretch mx-0.5" />
          <button onClick={toggleFavorite} className="p-1.5 rounded hover:bg-bg" title="Favorite">
            <Star size={15} className={favorite ? 'fill-yellow-400 stroke-yellow-500' : ''} />
          </button>
          <button onClick={deletePage} className="p-1.5 rounded hover:bg-bg text-muted hover:text-red-500" title="Delete page">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* ── Formatting toolbar (operates on currently-focused block) ──── */}
      <div className="flex items-center gap-0.5 px-5 py-1 border-b border-border bg-surface/50 shrink-0 flex-wrap text-muted">
        {/* Inline marks */}
        <FmtBtn icon={<Bold size={14} />} title="Bold (Ctrl/Cmd+B)"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleBold().run())} />
        <FmtBtn icon={<Italic size={14} />} title="Italic (Ctrl/Cmd+I)"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleItalic().run())} />
        <FmtBtn icon={<Underline size={14} />} title="Underline (Ctrl/Cmd+U)"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleUnderline().run())} />
        <FmtBtn icon={<Strikethrough size={14} />} title="Strikethrough"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleStrike().run())} />
        <FmtBtn icon={<Link2 size={14} />} title="Add / edit link"
          onAct={async () => {
            const fid = focusedBlockRef.current ?? lastFocusedId.current;
            const ed = fid ? editorRefs.current[fid] : null;
            if (!ed) return;
            const prev = ed.getAttributes('link')?.href ?? '';
            const url = await promptDialog({
              title: 'Link', message: 'Enter a URL (leave blank to remove the link).',
              defaultValue: prev, placeholder: 'https://example.com',
            });
            if (url === null) return;
            if (url.trim() === '') {
              ed.chain().focus().extendMarkRange('link').unsetLink().run();
              return;
            }
            const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
            const sel = ed.state.selection;
            if (sel.empty) {
              // No text selected — insert the URL as the (linked) text,
              // otherwise setLink on a collapsed cursor is invisible.
              ed.chain().focus()
                .insertContent({
                  type: 'text',
                  text: url.trim(),
                  marks: [{ type: 'link', attrs: { href } }],
                })
                .run();
            } else {
              ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
            }
          }} />
        {/* Font family — a <select> must receive the click to open its
            dropdown, so we can't preventDefault to keep editor focus like
            FmtBtn does. Instead capture the focused editor on mousedown
            (before it blurs) and apply the font on change. */}
        <select
          title="Font"
          onMouseDown={() => {
            const id = focusedBlockRef.current;
            fontTargetEditor.current = id ? editorRefs.current[id] ?? null : null;
          }}
          onChange={(e) => {
            const v = e.target.value;
            const ed = fontTargetEditor.current;
            if (ed) {
              if (v) ed.chain().focus().setFontFamily(v).run();
              else ed.chain().focus().unsetFontFamily().run();
            }
            e.currentTarget.selectedIndex = 0;
          }}
          className="ml-1 bg-bg border border-border rounded text-xs px-1 py-1 text-muted hover:text-text focus:outline-none cursor-pointer"
        >
          <option value="">Font</option>
          <option value="ui-sans-serif, system-ui, sans-serif">Sans</option>
          <option value="ui-serif, Georgia, serif">Serif</option>
          <option value="ui-monospace, Menlo, monospace">Mono</option>
          <option value="Inter, sans-serif">Inter</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="'Times New Roman', serif">Times</option>
          <option value="Courier, monospace">Courier</option>
        </select>
        {/* Font size */}
        <FmtBtn icon={<Minus size={14} />} title="Decrease font size"
          onAct={() => runOnFocused((e) => {
            const cur = parseInt(e.getAttributes('textStyle')?.fontSize ?? '16', 10) || 16;
            e.chain().focus().setFontSize(`${Math.max(10, cur - 2)}px`).run();
          })} />
        <FmtBtn icon={<Plus size={14} />} title="Increase font size"
          onAct={() => runOnFocused((e) => {
            const cur = parseInt(e.getAttributes('textStyle')?.fontSize ?? '16', 10) || 16;
            e.chain().focus().setFontSize(`${Math.min(72, cur + 2)}px`).run();
          })} />
        <div className="w-px self-stretch bg-border mx-1" />
        <FmtBtn icon={<Heading1 size={14} />} title="Heading 1"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleHeading({ level: 1 }).run())} />
        <FmtBtn icon={<Heading2 size={14} />} title="Heading 2"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleHeading({ level: 2 }).run())} />
        <FmtBtn icon={<Heading3 size={14} />} title="Heading 3"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleHeading({ level: 3 }).run())} />
        <div className="w-px self-stretch bg-border mx-1" />
        <FmtBtn icon={<List size={14} />} title="Bulleted list"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleBulletList().run())} />
        <FmtBtn icon={<ListOrdered size={14} />} title="Numbered list"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleOrderedList().run())} />
        <FmtBtn icon={<ListChecks size={14} />} title="To-do list"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleTaskList().run())} />
        <div className="w-px self-stretch bg-border mx-1" />
        <FmtBtn icon={<Quote size={14} />} title="Quote"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleBlockquote().run())} />
        <FmtBtn icon={<Code size={14} />} title="Code block"
          onAct={() => runOnFocused((e) => e.chain().focus().toggleCodeBlock().run())} />
        <div className="w-px self-stretch bg-border mx-1" />
        <button
          type="button"
          title="Upload image"
          onMouseDown={(e) => { e.preventDefault(); imageInputRef.current?.click(); }}
          className="p-1.5 rounded hover:bg-bg hover:text-text transition-colors"
        >
          <ImageIcon size={14} />
        </button>
        <div className="w-px self-stretch bg-border mx-1" />
        <FmtBtn icon={<Undo2 size={14} />} title="Undo (Ctrl/Cmd+Z)"
          onAct={() => runOnFocused((e) => e.chain().focus().undo().run())} />
        <FmtBtn icon={<Redo2 size={14} />} title="Redo (Ctrl/Cmd+Shift+Z)"
          onAct={() => runOnFocused((e) => e.chain().focus().redo().run())} />
        <span className="ml-2 text-[10px] text-muted/60 hidden sm:inline">
          Tip: press &quot;/&quot; in any block for the slash menu
        </span>
      </div>

      {/* ── Audio recorder panel ─────────────────────────────────────── */}
      {recordOpen && (
        <div className="px-5 py-3 border-b border-border bg-surface shrink-0">
          {/* AudioRecorder needs an editor prop — give it a proxy that inserts a new block */}
          <AudioRecorderProxy
            onTranscript={(text) => {
              createBlock(DOC_X, nextStackY(), DOC_W_TEXT, 'text', {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
              });
            }}
            onClose={() => setRecordOpen(false)}
          />
        </div>
      )}

      {/* ── Canvas scroll area ────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        // `pan-x pan-y` keeps single-finger scroll/pan behavior from the
        // browser while reserving two-finger gestures (pinch) for our
        // own handler. Important — `manipulation` does NOT do this; it
        // disables only double-tap zoom and still lets the browser
        // claim pinch as page-zoom (which made the page scale before
        // our touchmove handler could preventDefault). When a block is
        // actively being moved we lock down to `none` so the browser
        // doesn't try to scroll mid-drag.
        style={{ touchAction: movingBlockId ? 'none' : 'pan-x pan-y' }}
      >
        {/* Wrapper sized to the scaled content so scrollbars stay correct */}
        <div style={{ width: canvasW * zoom, height: canvasH * zoom }}>
        <div
          ref={innerRef}
          style={{
            position: 'relative',
            width: canvasW,
            height: canvasH,
            cursor: 'text',
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
          onPointerDown={handleCanvasPointerDown}
          onClick={handleCanvasClick}
        >
          {/* Empty-canvas hint — shown for fresh notes so users discover
              the "tap to add a block" interaction. pointer-events-none so
              the hint itself never absorbs the very tap it's prompting. */}
          {blocks.length === 0 && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden="true"
            >
              <div className="text-center text-muted/60 px-4">
                <p className="text-sm">Tap anywhere to add a block</p>
                <p className="text-xs mt-1">
                  Then type <kbd className="font-mono bg-bg/50 border border-border/50 rounded px-1 py-0.5 text-[10px]">/</kbd> inside it for the slash menu
                </p>
              </div>
            </div>
          )}
          {blocks.map((b) => (
            <CanvasCard
              key={b.id}
              block={b}
              zoom={zoom}
              isMoving={movingBlockId === b.id}
              onDragStart={startDrag}
              onDelete={handleDeleteBlock}
              onContentUpdate={handleContentUpdate}
              onBlockEmpty={handleDeleteBlock}
              registerEditor={registerEditor}
              onHover={handleHover}
              onFocusChange={handleFocusChange}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
              onResizeHeight={handleResizeHeight}
              onResizeHeightEnd={handleResizeHeightEnd}
              onDoubleTap={focusOnBlock}
              onInsertDatabase={addDatabaseBlock}
            />
          ))}

          {/* Hint when canvas is empty */}
          {blocks.length === 0 && (
            <div style={{ position: 'absolute', left: DOC_X, top: 60 }} className="text-muted/60 text-sm pointer-events-none select-none">
              Click anywhere to start writing
            </div>
          )}
        </div>
        </div>

      </div>

      {/* Floating zoom controls — fixed to bottom-right of viewport */}
      <div className="fixed bottom-4 right-4 z-30 flex items-center gap-0.5 bg-surface/95 border border-border rounded-lg shadow-md px-1 py-0.5 backdrop-blur">
        <button
          onClick={() => stepZoom(-0.1)}
          className="p-1.5 rounded hover:bg-bg text-muted hover:text-text"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={fitToScreen}
          className="px-2 py-0.5 text-xs font-mono text-muted hover:text-text rounded hover:bg-bg min-w-[3.5rem]"
          title="Fit to screen"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => stepZoom(0.1)}
          className="p-1.5 rounded hover:bg-bg text-muted hover:text-text"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="p-1.5 rounded hover:bg-bg text-muted hover:text-text"
          title="Reset to 100%"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {organizeOpen && (
        <OrganizeModal
          rawText={getAllText()}
          onClose={() => setOrganizeOpen(false)}
          onAccept={handleOrganize}
        />
      )}
      {summarizeOpen && (
        <SummarizeModal
          rawText={getAllText()}
          onClose={() => setSummarizeOpen(false)}
          onInsert={handleSummarizeInsert}
        />
      )}
      {youtubeOpen && (
        <YouTubeImportModal
          onClose={() => setYoutubeOpen(false)}
          onImport={handleYouTubeImport}
        />
      )}
      {tiktokOpen && (
        <TikTokImportModal
          onClose={() => setTiktokOpen(false)}
          onImport={handleTikTokImport}
        />
      )}
      {moodboardOpen && (
        <MoodBoardModal
          onClose={() => setMoodboardOpen(false)}
          onInsert={(images) => {
            // Drop each picked image onto the canvas as its own block,
            // stacked vertically. Compute the starting Y ONCE — calling
            // nextStackY() per iteration reads the still-stale blocks
            // state (React batches state updates inside a single tick)
            // so every image would land at the exact same coordinate
            // and overlap. Manually walk Y forward instead.
            //
            // 280px = our rough "image card" height + gap; the canvas
            // already auto-sizes when image dimensions settle so this
            // is just a placement hint, not a hard layout commitment.
            let y = nextStackY();
            const STACK_STEP = 280;
            images.forEach((img) => {
              createBlock(DOC_X, y, DOC_W_TEXT, 'text', {
                type: 'doc',
                content: [{ type: 'image', attrs: { src: img.url, width: null, alt: img.alt } }],
              });
              y += STACK_STEP;
            });
          }}
        />
      )}

      {/* Hidden file input for image uploads. `multiple` so the OS picker
          lets the user pick a batch — they then land as a vertical stack
          of blocks. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) uploadImages(files);
          // Reset so picking the same file(s) again still triggers onChange.
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ——— Compact formatting toolbar button ————————————————————————————————
// onMouseDown + preventDefault keeps focus on the editor while the command runs.
function FmtBtn({
  icon,
  title,
  onAct,
}: {
  icon: React.ReactNode;
  title: string;
  onAct: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onAct(); }}
      className="p-1.5 rounded hover:bg-bg hover:text-text transition-colors"
    >
      {icon}
    </button>
  );
}

// ——— AudioRecorderProxy ——————————————————————————————————————————————————
// AudioRecorder expects a TipTap editor instance. This proxy creates a fake
// editor-like object that routes the transcript into a new canvas block.

function AudioRecorderProxy({
  onTranscript,
  onClose,
}: {
  onTranscript: (text: string) => void;
  onClose: () => void;
}) {
  const fakeEditor = {
    chain: () => ({
      focus: () => ({
        insertContent: (html: string) => ({
          run: () => {
            // Strip the <p>...</p> wrapper AudioRecorder adds
            const text = html.replace(/<\/?p>/g, '').trim();
            onTranscript(text);
          },
        }),
      }),
    }),
  } as any;

  return <AudioRecorder editor={fakeEditor} onClose={onClose} />;
}
