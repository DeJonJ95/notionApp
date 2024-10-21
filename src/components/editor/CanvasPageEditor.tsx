'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Star, Trash2, Sparkles, ImageIcon, Database, Mic, ClipboardList, GripHorizontal, X, Plus } from 'lucide-react';
import { CanvasTextBlock } from '@/components/editor/CanvasTextBlock';
import { OrganizeModal } from '@/components/extract/OrganizeModal';
import { AudioRecorder } from '@/components/editor/AudioRecorder';
import { SummarizeModal } from '@/components/editor/SummarizeModal';

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

function docToCanvasBlocks(doc: any): Omit<CanvasBlockData, 'id'>[] {
  const nodes: any[] = doc?.content ?? [];
  const out: Omit<CanvasBlockData, 'id'>[] = [];
  let j = 0;

  while (j < nodes.length) {
    const n = nodes[j];
    const lvl = n.type === 'heading' ? (n.attrs?.level ?? 99) : 99;

    if (n.type === 'databaseEmbed') {
      out.push({
        type: 'database',
        content: { databaseId: n.attrs?.databaseId ?? null },
        canvasX: 40 + (out.length % 2) * 680,
        canvasY: 60 + Math.floor(out.length / 2) * 460,
        canvasWidth: 640,
      });
      j++;
    } else if (n.type === 'heading' && lvl <= 2) {
      // Group heading + its following content into one card
      const group: any[] = [n];
      j++;
      while (j < nodes.length) {
        const nx = nodes[j];
        if (nx.type === 'heading' && (nx.attrs?.level ?? 99) <= lvl) break;
        if (nx.type === 'databaseEmbed') break;
        group.push(nx);
        j++;
      }
      out.push({
        type: 'text',
        content: { type: 'doc', content: group },
        canvasX: 40 + (out.length % 3) * 460,
        canvasY: 60 + Math.floor(out.length / 3) * 380,
        canvasWidth: 420,
      });
    } else {
      out.push({
        type: 'text',
        content: { type: 'doc', content: [n] },
        canvasX: 40 + (out.length % 3) * 360,
        canvasY: 60 + Math.floor(out.length / 3) * 320,
        canvasWidth: 320,
      });
      j++;
    }
  }
  return out;
}

// ——— Individual Canvas Card ———————————————————————————————————————————————

function CanvasCard({
  block,
  onDragStart,
  onDelete,
  onContentUpdate,
  onBlockEmpty,
  registerEditor,
}: {
  block: CanvasBlockData;
  onDragStart: (blockId: string, cx: number, cy: number, ox: number, oy: number) => void;
  onDelete: (id: string) => void;
  onContentUpdate: (id: string, content: any) => void;
  onBlockEmpty: (id: string) => void;
  registerEditor: (id: string, editor: any) => void;
}) {
  const isDraggingRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Alt+drag anywhere on the card, OR pointer on the grip handle
    const onHandle = (e.target as HTMLElement).closest('[data-drag-handle]');
    if (!e.altKey && !onHandle) return;
    isDraggingRef.current = true;
    onDragStart(block.id, e.clientX, e.clientY, block.canvasX, block.canvasY);
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: block.canvasX,
        top: block.canvasY,
        width: block.canvasWidth,
        zIndex: 2,
        cursor: 'default',
      }}
      className="bg-surface border border-border rounded-xl shadow-md flex flex-col group"
      onPointerDown={handlePointerDown}
    >
      {/* Card toolbar — shown on hover */}
      <div className="absolute -top-7 left-0 hidden group-hover:flex items-center gap-1 bg-surface border border-border rounded-lg px-1.5 py-0.5 shadow-sm z-10">
        <span
          data-drag-handle
          className="p-0.5 rounded cursor-grab active:cursor-grabbing text-muted hover:text-text"
          title="Drag (or hold Alt + drag)"
        >
          <GripHorizontal size={13} />
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(block.id)}
          className="p-0.5 rounded text-muted hover:text-red-500"
          title="Delete block"
        >
          <X size={13} />
        </button>
      </div>

      <div className="p-4 overflow-y-auto max-h-[520px]">
        {block.type === 'database' ? (
          <CanvasDatabaseBlock databaseId={block.content?.databaseId} />
        ) : (
          <CanvasTextBlock
            blockId={block.id}
            initialContent={block.content}
            onUpdate={onContentUpdate}
            onEmpty={onBlockEmpty}
            getEditorRef={registerEditor}
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
  const [newBlockId, setNewBlockId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    blockId: string;
    startCX: number; startCY: number;
    origX: number; origY: number;
  } | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRefs = useRef<Record<string, any>>({});
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
      // New empty page — create one starter block
      createBlock(60, 60, 420);
      return;
    }

    // Migrate old TipTap document to canvas blocks
    const oldBlock = initialBlocks[0];
    const converted = docToCanvasBlocks(oldBlock.content);

    if (converted.length === 0) {
      // Empty doc
      createBlock(60, 60, 420);
      // Delete the old document block
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

  // ── Block creation ─────────────────────────────────────────────────────
  const createBlock = useCallback(
    async (x: number, y: number, width = 320, type = 'text', content?: any) => {
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
    (blockId: string, cx: number, cy: number, ox: number, oy: number) => {
      dragState.current = { blockId, startCX: cx, startCY: cy, origX: ox, origY: oy };
    },
    []
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const { blockId, startCX, startCY, origX, origY } = dragState.current;
    const newX = Math.max(0, origX + e.clientX - startCX);
    const newY = Math.max(0, origY + e.clientY - startCY);
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, canvasX: newX, canvasY: newY } : b))
    );
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragState.current) return;
    const { blockId } = dragState.current;
    dragState.current = null;
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
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
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
  }, []);

  // ── Editor ref registry (for summarize/organize) ──────────────────────
  const registerEditor = useCallback((id: string, editor: any) => {
    editorRefs.current[id] = editor;
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

  // ── Add a database embed block ────────────────────────────────────────
  const addDatabaseBlock = () => {
    const x = 60 + (blocks.length % 2) * 700;
    const y = Math.max(...blocks.map((b) => b.canvasY + 460), 60);
    createBlock(x, y, 640, 'database', { databaseId: null });
  };

  // ── Canvas size (expands to fit all blocks) ───────────────────────────
  const canvasW = Math.max(2400, ...blocks.map((b) => b.canvasX + b.canvasWidth + 120));
  const canvasH = Math.max(1600, ...blocks.map((b) => b.canvasY + 560));

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

  // ── Handle summarize insert ────────────────────────────────────────────
  const handleSummarizeInsert = async (html: string) => {
    // Insert a new text block at top-left
    const block = await createBlock(60, 60, 500, 'text', {
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
            onClick={() => createBlock(60, Math.max(...blocks.map((b) => b.canvasY + 340), 60), 420)}
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

      {/* ── Audio recorder panel ─────────────────────────────────────── */}
      {recordOpen && (
        <div className="px-5 py-3 border-b border-border bg-surface shrink-0">
          {/* AudioRecorder needs an editor prop — give it a proxy that inserts a new block */}
          <AudioRecorderProxy
            onTranscript={(text) => {
              createBlock(
                60,
                Math.max(...blocks.map((b) => b.canvasY + 340), 60),
                420,
                'text',
                { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
              );
            }}
            onClose={() => setRecordOpen(false)}
          />
        </div>
      )}

      {/* ── Canvas scroll area ────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          ref={innerRef}
          style={{
            position: 'relative',
            width: canvasW,
            height: canvasH,
            backgroundImage: 'radial-gradient(rgba(150,150,150,0.15) 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px',
            cursor: 'crosshair',
          }}
          onClick={handleCanvasClick}
        >
          {blocks.map((b) => (
            <CanvasCard
              key={b.id}
              block={b}
              onDragStart={startDrag}
              onDelete={handleDeleteBlock}
              onContentUpdate={handleContentUpdate}
              onBlockEmpty={handleDeleteBlock}
              registerEditor={registerEditor}
            />
          ))}

          {/* Hint when canvas is empty */}
          {blocks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              <p className="text-muted text-sm">Click anywhere to start writing</p>
            </div>
          )}
        </div>
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
    </div>
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
