'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Star, Trash2, Sparkles, ImageIcon, Database, Mic, ClipboardList, GripVertical, X, Plus, Youtube, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { CanvasTextBlock } from '@/components/editor/CanvasTextBlock';
import { OrganizeModal } from '@/components/extract/OrganizeModal';
import { AudioRecorder } from '@/components/editor/AudioRecorder';
import { SummarizeModal } from '@/components/editor/SummarizeModal';
import { YouTubeImportModal } from '@/components/editor/YouTubeImportModal';

// Break circular dep: CanvasPageEditor → DatabaseView → CanvasPageEditor
const DatabaseViewDynamic = dynamic(
  () => import('@/components/database/DatabaseView').then((m) => m.DatabaseView),
  { ssr: false, loading: () => <div className="p-4 text-muted text-sm">Loading database…</div> }
);

// Fetches database by ID then renders DatabaseView — mirrors DatabaseEmbedView logic
function CanvasDatabaseBlock({ databaseId }: { databaseId: string | null }) {
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
            onChange={(e) => { if (e.target.value) setData(null); /* handled via databaseId prop */ }}
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
const DOC_W_DB = 1100; // wider default so DB split-view is actually usable
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
}) {
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

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
  };

  // ── Resize handlers ────────────────────────────────────────────────────
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startW: block.canvasWidth };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    // Screen-space delta → canvas-space delta when scaled
    const dx = (e.clientX - resizeRef.current.startX) / (zoom || 1);
    const w = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, resizeRef.current.startW + dx));
    onResize(block.id, w);
  };
  const onResizeUp = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    onResizeEnd(block.id);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: block.canvasX,
        top: block.canvasY,
        width: block.canvasWidth,
        zIndex: isMoving ? 10 : 2,
      }}
      className={`group transition-shadow ${isMoving ? 'ring-2 ring-accent rounded-lg shadow-xl' : ''}`}
      onPointerDown={handlePointerDown}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Desktop hover handles — only on hover-capable devices */}
      <div className="absolute -left-9 top-1 hidden group-hover:flex flex-col gap-0.5 z-10 [@media(hover:none)]:!hidden">
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

      {/* Mobile drag bar — always visible on touch devices (hover:none).
          Tap it to immediately start dragging; the border + shadow shows you're in move mode. */}
      <div
        data-drag-handle
        style={{ touchAction: 'none' }}
        className={`hidden [@media(hover:none)]:flex absolute -top-6 left-0 right-0 h-6 items-center justify-center z-10 rounded-t-lg transition-colors ${
          isMoving ? 'bg-accent/20' : 'bg-transparent'
        }`}
      >
        <div className={`w-10 h-1 rounded-full transition-colors ${isMoving ? 'bg-accent/70' : 'bg-muted/40'}`} />
        {isMoving && (
          <span className="absolute left-2 text-[10px] text-accent font-medium select-none">
            moving — lift to drop
          </span>
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(block.id)}
          className="absolute right-1 top-0.5 p-0.5 rounded text-muted hover:text-red-500 hover:bg-surface"
          title="Delete block"
        >
          <X size={14} />
        </button>
      </div>

      {block.type === 'database' ? (
        // Databases keep their own border since they're a structured thing
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <CanvasDatabaseBlock databaseId={block.content?.databaseId} />
        </div>
      ) : (
        // Text blocks render flush — no card, no border, no padding.
        // Looks like normal document content.
        <CanvasTextBlock
          blockId={block.id}
          initialContent={block.content}
          onUpdate={onContentUpdate}
          onEmpty={onBlockEmpty}
          getEditorRef={registerEditor}
          onFocusChange={onFocusChange}
        />
      )}

      {/* Right-edge resize handle — invisible until hover, blue on grab */}
      <div
        data-resize-handle
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        className="absolute top-1 -right-0.5 w-2 h-[calc(100%-8px)] cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-accent/60 transition-colors z-10 rounded"
        style={{ touchAction: 'none' }}
        title="Drag to resize"
      />
    </div>
  );
}

// ——— CanvasPageEditor ——————————————————————————————————————————————————————

export function CanvasPageEditor({
  page,
  initialBlocks,
}: {
  page: PageData;
  initialBlocks: CanvasBlockData[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [favorite, setFavorite] = useState(page.isFavorite);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('saved');
  const [blocks, setBlocks] = useState<CanvasBlockData[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [newBlockId, setNewBlockId] = useState<string | null>(null);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  // Canvas-level zoom (transform-scale on the inner canvas; not browser zoom)
  const [zoom, setZoom] = useState(1);
  // Mirror in a ref so pointer/touch handlers always read the live value
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    blockId: string;
    startCX: number; startCY: number;
    origX: number; origY: number;
  } | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRefs = useRef<Record<string, any>>({});
  // Track which block is "active" for keyboard shortcuts (Alt+Delete)
  const hoveredBlockRef = useRef<string | null>(null);
  const focusedBlockRef = useRef<string | null>(null);
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
  const nextStackY = useCallback(() => {
    if (blocks.length === 0) return 60;
    return Math.max(
      ...blocks.map((b) => b.canvasY + (b.type === 'database' ? 440 : 120))
    ) + BLOCK_GAP;
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

  // ── Drag ───────────────────────────────────────────────────────────────
  const startDrag = useCallback(
    (blockId: string, cx: number, cy: number, ox: number, oy: number, pointerId: number) => {
      dragState.current = { blockId, startCX: cx, startCY: cy, origX: ox, origY: oy };
      setMovingBlockId(blockId);
      // Capture on the scroll container so it receives all pointer events even
      // when the finger moves outside the block — the block's own div won't work
      // because the canvas onPointerMove is what actually repositions the block.
      try { scrollRef.current?.setPointerCapture(pointerId); } catch {}
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    },
    []
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const { blockId, startCX, startCY, origX, origY } = dragState.current;
    // Screen-space delta → canvas-space delta when canvas is scaled
    const z = zoomRef.current;
    const newX = Math.max(0, origX + (e.clientX - startCX) / z);
    const newY = Math.max(0, origY + (e.clientY - startCY) / z);
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, canvasX: newX, canvasY: newY } : b))
    );
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragState.current) return;
    const { blockId } = dragState.current;
    dragState.current = null;
    setMovingBlockId(null);
    setBlocks((prev) => {
      const b = prev.find((x) => x.id === blockId);
      if (b) {
        fetch(`/api/blocks/${blockId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasX: b.canvasX, canvasY: b.canvasY }),
        }).catch(() => {});
      }
      return prev;
    });
  }, []);

  // ── Click empty canvas to create block ────────────────────────────────
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragState.current) return;
      if (e.target !== innerRef.current) return; // only on blank canvas
      const rect = innerRef.current!.getBoundingClientRect();
      // rect is the transformed (visual) box; divide by zoom to recover canvas coords
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

  // ── Alt+Delete keyboard shortcut ──────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'Delete') return;
      const tag = (e.target as HTMLElement)?.tagName;
      // Skip if focused inside a plain input or textarea (e.g. page title)
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const target = focusedBlockRef.current || hoveredBlockRef.current;
      if (!target) return;
      e.preventDefault();
      handleDeleteBlock(target);
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
    const id = focusedBlockRef.current;
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
    const next = prompt('Enter an emoji', icon ?? '📄');
    if (next !== null) {
      setIcon(next || null);
      await saveMeta({ icon: next || null }, true);
    }
  };

  const deletePage = async () => {
    if (!window.confirm(`Delete "${title || 'Untitled'}"? This cannot be undone.`)) return;
    await fetch(`/api/pages/${page.id}`, { method: 'DELETE' });
    router.push('/');
    router.refresh();
  };

  // ── Add a database embed block (stacked below existing content) ───────
  const addDatabaseBlock = () => {
    createBlock(DOC_X, nextStackY(), DOC_W_DB, 'database', { databaseId: null });
  };

  // ── Canvas size — grows with content ──────────────────────────────────
  const canvasW = Math.max(900, ...blocks.map((b) => b.canvasX + b.canvasWidth + 80));
  const canvasH = Math.max(600, ...blocks.map((b) => b.canvasY + 400));

  // ── Pinch-zoom on touch ───────────────────────────────────────────────
  const pinchRef = useRef<{ initialDist: number; initialZoom: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    pinchRef.current = {
      initialDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      initialZoom: zoomRef.current,
    };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = dist / pinchRef.current.initialDist;
    const z = Math.max(0.25, Math.min(2, pinchRef.current.initialZoom * ratio));
    setZoom(z);
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinchRef.current = null;
  };

  const fitToScreen = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fitX = el.clientWidth / canvasW;
    const fitY = el.clientHeight / canvasH;
    setZoom(Math.max(0.25, Math.min(1, Math.min(fitX, fitY))));
  }, [canvasW, canvasH]);

  const stepZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(0.25, Math.min(2, +(z + delta).toFixed(2))));
  }, []);

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

  // ── Handle YouTube transcript import ──────────────────────────────────
  const handleYouTubeImport = ({ title, text }: { title: string; text: string }) => {
    // Split the transcript into ~150-word paragraphs for readability
    const words = text.split(/\s+/);
    const PARA_SIZE = 150;
    const paragraphs: any[] = [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `📺 ${title}` }],
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
            onClick={() => setSummarizeOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
          >
            <ClipboardList size={12} /> Summarize
          </button>
          <button
            onClick={() => setYoutubeOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg transition"
            title="Import a YouTube video's transcript"
          >
            <Youtube size={12} className="text-red-500" /> YouTube
          </button>
          <button
            onClick={() => setOrganizeOpen(true)}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg text-accent transition"
          >
            <Sparkles size={12} /> Organize
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
        <FmtBtn icon={<ImageIcon size={14} />} title="Insert image (URL)"
          onAct={() => {
            const src = window.prompt('Image URL');
            if (src) runOnFocused((e) => e.chain().focus().setImage({ src }).run());
          }} />
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
        style={{ touchAction: movingBlockId ? 'none' : 'auto' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
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
          onClick={handleCanvasClick}
        >
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
