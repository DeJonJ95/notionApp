'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { DatabaseEmbed } from '@/components/editor/extensions/DatabaseEmbed';
import { GripHorizontal, X, Plus } from 'lucide-react';

interface Block {
  id: string;
  content: any; // { type: 'doc', content: [...nodes] }
  x: number;
  y: number;
  width: number;
}

// Split TipTap doc into canvas blocks.
// H1/H2 headings absorb following content until the next same-or-higher heading.
// Every other top-level node becomes its own block.
function docToBlocks(doc: any): Block[] {
  const nodes: any[] = doc?.content ?? [];
  const out: Block[] = [];
  let j = 0;

  while (j < nodes.length) {
    const n = nodes[j];
    const lvl = n.type === 'heading' ? (n.attrs?.level ?? 99) : 99;

    if (n.type === 'heading' && lvl <= 2) {
      const group: any[] = [n];
      j++;
      while (j < nodes.length) {
        const nx = nodes[j];
        if (nx.type === 'heading' && (nx.attrs?.level ?? 99) <= lvl) break;
        group.push(nx);
        j++;
      }
      out.push(makeBlock({ type: 'doc', content: group }, out.length, 400));
    } else {
      out.push(makeBlock({ type: 'doc', content: [n] }, out.length, 320));
      j++;
    }
  }
  return out;
}

let _uid = 0;
function makeBlock(content: any, idx: number, width: number): Block {
  return {
    id: `cb-${++_uid}`,
    content,
    x: 40 + (idx % 3) * (width + 48),
    y: 60 + Math.floor(idx / 3) * 380,
    width,
  };
}

function loadPos(pageId: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(`cvs-${pageId}`) ?? '{}'); }
  catch { return {}; }
}

// ——— CanvasCard ——————————————————————————————————————————————————————————
function CanvasCard({
  block,
  onMove,
  onChange,
  onRemove,
}: {
  block: Block;
  onMove: (id: string, x: number, y: number) => void;
  onChange: (id: string, content: any) => void;
  onRemove: (id: string) => void;
}) {
  const handleEl = useRef<HTMLDivElement>(null);
  const drag = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);
  // Always-fresh ref so onPointerDown captures the current position even after re-renders
  const pos = useRef({ x: block.x, y: block.y });
  pos.current = { x: block.x, y: block.y };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Image,
      DatabaseEmbed,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: block.content,
    onUpdate: ({ editor }) => onChange(block.id, editor.getJSON()),
    immediatelyRender: false,
  });

  useEffect(() => () => { editor?.destroy(); }, [editor]);

  const pd = (e: React.PointerEvent<HTMLDivElement>) => {
    handleEl.current?.setPointerCapture(e.pointerId);
    drag.current = { cx: e.clientX, cy: e.clientY, ox: pos.current.x, oy: pos.current.y };
    e.preventDefault();
  };
  const pm = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onMove(
      block.id,
      Math.max(0, drag.current.ox + e.clientX - drag.current.cx),
      Math.max(0, drag.current.oy + e.clientY - drag.current.cy),
    );
  };
  const pu = () => { drag.current = null; };

  return (
    <div
      style={{ position: 'absolute', left: block.x, top: block.y, width: block.width, zIndex: 2 }}
      className="bg-surface border border-border rounded-xl shadow-lg flex flex-col"
    >
      {/* Drag header */}
      <div
        ref={handleEl}
        className="h-8 rounded-t-xl border-b border-border flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none touch-none shrink-0"
        onPointerDown={pd}
        onPointerMove={pm}
        onPointerUp={pu}
        onPointerCancel={pu}
      >
        <GripHorizontal size={14} className="text-muted pointer-events-none" />
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(block.id)}
          className="p-0.5 rounded hover:bg-bg text-muted"
        >
          <X size={12} />
        </button>
      </div>
      {/* Editor body */}
      <div className="p-3 overflow-y-auto max-h-[460px]">
        <EditorContent
          editor={editor}
          className="prose-sm focus:outline-none text-text min-h-[32px]"
        />
      </div>
    </div>
  );
}

// ——— CanvasMode ——————————————————————————————————————————————————————————
export function CanvasMode({
  initialDoc,
  pageId,
  onExit,
  onSave,
}: {
  initialDoc: any;
  pageId: string;
  onExit: () => void;
  onSave: (doc: any) => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const base = docToBlocks(initialDoc);
    const saved = loadPos(pageId);
    return base.map((b, i) => ({ ...b, ...(saved[String(i)] ?? {}) }));
  });

  const move = useCallback((id: string, x: number, y: number) =>
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, x, y } : b))), []);

  const change = useCallback((id: string, content: any) =>
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, content } : b))), []);

  const remove = useCallback((id: string) =>
    setBlocks((p) => p.filter((b) => b.id !== id)), []);

  const addBlock = () =>
    setBlocks((p) => [...p, makeBlock({ type: 'doc', content: [{ type: 'paragraph' }] }, p.length, 320)]);

  // Persist positions to localStorage on every move
  useEffect(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    blocks.forEach((b, i) => { pos[String(i)] = { x: b.x, y: b.y }; });
    try { localStorage.setItem(`cvs-${pageId}`, JSON.stringify(pos)); } catch {}
  }, [blocks, pageId]);

  const done = () => {
    // Reassemble doc: sort cards top→bottom, left→right
    const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    const nodes = sorted.flatMap((b) => b.content?.content ?? []);
    onSave({ type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] });
    onExit();
  };

  const canvasW = Math.max(1600, ...blocks.map((b) => b.x + b.width + 80));
  const canvasH = Math.max(1000, ...blocks.map((b) => b.y + 520));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text">Canvas</span>
          <span className="text-xs text-muted">Drag cards anywhere · click content to edit</span>
          <button
            onClick={addBlock}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1 hover:bg-bg text-muted hover:text-text transition"
          >
            <Plus size={12} /> Add block
          </button>
        </div>
        <button
          onClick={done}
          className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition"
        >
          Done
        </button>
      </div>

      {/* Canvas scroll area */}
      <div className="flex-1 overflow-auto">
        <div
          style={{
            position: 'relative',
            width: canvasW,
            height: canvasH,
            backgroundImage: 'radial-gradient(rgba(150,150,150,0.18) 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px',
          }}
        >
          {blocks.map((b) => (
            <CanvasCard
              key={b.id}
              block={b}
              onMove={move}
              onChange={change}
              onRemove={remove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
