'use client';
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import { FontSize } from './FontSize';
import { ResizableImage, getImageStorage } from './ResizableImage';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

interface SlashCmd {
  title: string;
  description: string;
  run: (editor: any) => void;
  // 'database' is not a TipTap command — it reaches up to the parent canvas
  // to insert a separate database block alongside this text block.
  kind?: 'text' | 'database';
}

const SLASH_COMMANDS: SlashCmd[] = [
  { title: 'Text',          description: 'Plain paragraph',         run: (e) => e.chain().focus().setParagraph().run() },
  { title: 'Heading 1',     description: 'Large section title',     run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: 'Heading 2',     description: 'Smaller section title',   run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: 'Heading 3',     description: 'Subsection',              run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: 'Bulleted list', description: '• item',                  run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: 'Numbered list', description: '1. item',                 run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: 'To-do list',    description: '☐ checkbox item',         run: (e) => e.chain().focus().toggleTaskList().run() },
  { title: 'Quote',         description: 'Block quote',             run: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: 'Code block',    description: 'Monospace code',          run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: 'Database',      description: 'Embed a database',         run: () => {}, kind: 'database' },
];

interface Props {
  blockId: string;
  initialContent: any;
  autoFocus?: boolean;
  zoom?: number;
  onUpdate: (blockId: string, content: any) => void;
  onEmpty?: (blockId: string) => void;
  getEditorRef?: (blockId: string, editor: any) => void;
  onFocusChange?: (blockId: string | null) => void;
  // Called by the embedded ResizableImage when the user resizes an image
  // inside this block. Lets the parent canvas block follow the image width.
  onImageResize?: (width: number, isFinal: boolean) => void;
  // Called when an image inside this block enters / leaves selection mode.
  // Lets the parent canvas block treat a touch as "drag to move" without
  // the 400ms long-press wait while an image is selected (Canva-style).
  onImageSelectedChange?: (selected: boolean) => void;
  // Called when the user picks "Database" from the slash menu.
  // Creates a new database block on the parent canvas alongside this text block.
  onInsertDatabase?: () => void;
}

export function CanvasTextBlock({
  blockId,
  initialContent,
  autoFocus,
  zoom,
  onUpdate,
  onEmpty,
  getEditorRef,
  onFocusChange,
  onImageResize,
  onImageSelectedChange,
  onInsertDatabase,
}: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  // Viewport coords of the caret when the slash menu opened. The canvas
  // applies transform:scale on an ancestor (which would break position:fixed),
  // so the menu is portalled to <body> and placed at these coords.
  const [slashPos, setSlashPos] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Mirror state in a ref so the editor's keydown closure (created once at
  // mount) can always read the latest values without going stale.
  const slashRef = useRef({ open: false, idx: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Mirror in a ref so the mount-time keydown closure can always read the
  // latest onInsertDatabase without going stale.
  const insertDbRef = useRef(onInsertDatabase);
  insertDbRef.current = onInsertDatabase;

  const scheduleSave = useCallback(
    (editor: any) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onUpdate(blockId, editor.getJSON());
      }, 600);
    },
    [blockId, onUpdate]
  );

  const closeSlash = useCallback(() => {
    slashRef.current.open = false;
    setSlashOpen(false);
    setSlashIdx(0);
  }, []);

  const runSlash = useCallback((editor: any, idx: number) => {
    const cmd = SLASH_COMMANDS[idx];
    if (!cmd) { closeSlash(); return; }
    if (cmd.kind === 'database') {
      // Database blocks are canvas-level, not TipTap nodes — tell the
      // parent canvas to insert one alongside this text block.
      insertDbRef.current?.();
    } else if (editor) {
      cmd.run(editor);
    }
    closeSlash();
  }, [closeSlash]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      ResizableImage,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: ({ editor }) => scheduleSave(editor),
    onFocus: () => onFocusChange?.(blockId),
    onBlur: () => {
      // Slight delay so a click on the slash menu doesn't fire blur before
      // the menu's mousedown handler runs.
      setTimeout(() => onFocusChange?.(null), 100);
    },
    editorProps: {
      // Links: openOnClick is false so a plain click can place the caret for
      // editing. Cmd/Ctrl/Alt+click (or a tap on touch, where editing-intent
      // is rare) opens the link in a new tab.
      handleClick: (view, _pos, event) => {
        const el = (event.target as HTMLElement | null)?.closest?.('a');
        const href = el?.getAttribute('href');
        if (!href) return false;
        const mod = event.metaKey || event.ctrlKey || event.altKey;
        // ProseMirror hands handleClick a MouseEvent, so event.pointerType
        // is always undefined — that broke link taps on mobile. Detect a
        // touch device by capability instead (coarse pointer / no hover).
        const isTouchDevice =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          (window.matchMedia('(pointer: coarse)').matches ||
            window.matchMedia('(hover: none)').matches);
        if (mod || isTouchDevice) {
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        // ── Slash menu open ────────────────────────────────────────────
        if (
          event.key === '/' &&
          !event.metaKey && !event.ctrlKey && !event.altKey &&
          !slashRef.current.open
        ) {
          const { from, $from } = view.state.selection;
          const atBlockStart = $from.parentOffset === 0;
          const before = from > 0 ? view.state.doc.textBetween(from - 1, from, '\0', '\0') : '';
          if (atBlockStart || /\s/.test(before)) {
            event.preventDefault();
            // coordsAtPos returns real post-transform viewport coordinates,
            // so this is correct even with canvas zoom/scroll.
            let pos: { left: number; top: number } | null = null;
            try {
              const c = view.coordsAtPos(from);
              pos = { left: c.left, top: c.bottom + 4 };
            } catch {}
            slashRef.current = { open: true, idx: 0 };
            setSlashPos(pos);
            setSlashOpen(true);
            setSlashIdx(0);
            return true;
          }
        }

        // ── Slash menu navigation ─────────────────────────────────────
        if (slashRef.current.open) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            const next = (slashRef.current.idx + 1) % SLASH_COMMANDS.length;
            slashRef.current.idx = next;
            setSlashIdx(next);
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            const prev = slashRef.current.idx === 0 ? SLASH_COMMANDS.length - 1 : slashRef.current.idx - 1;
            slashRef.current.idx = prev;
            setSlashIdx(prev);
            return true;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const ed = (view as any).editor ?? editor;
            runSlash(ed, slashRef.current.idx);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            closeSlash();
            return true;
          }
        }

        // ── Backspace on empty → delete block ─────────────────────────
        if (event.key === 'Backspace' && onEmpty && !slashRef.current.open) {
          const { doc } = view.state;
          const isEmpty =
            doc.childCount === 1 &&
            doc.firstChild?.type.name === 'paragraph' &&
            doc.firstChild?.childCount === 0;
          if (isEmpty) {
            onEmpty(blockId);
            return true;
          }
        }
        return false;
      },
    },
    immediatelyRender: false,
  });

  // Expose the image-resize callback to the ResizableImage NodeView.
  // Uses the WeakMap-based getImageStorage (not editor.storage.image) so
  // multiple CanvasTextBlock instances don't overwrite each other's callbacks.
  useEffect(() => {
    if (!editor) return;
    const s = getImageStorage(editor);
    if (s) {
      s.onResize = onImageResize ?? null;
      s.onSelectedChange = onImageSelectedChange ?? null;
      // ResizableImage fires this after the long-press-menu Delete IF the
      // doc is empty afterward. Route it to onEmpty (the same path that
      // the Backspace-on-empty handler uses) so the canvas drops the
      // whole block instead of leaving a stranded empty text block.
      s.onEmpty = onEmpty ? () => onEmpty(blockId) : null;
    }
    return () => {
      const s2 = getImageStorage(editor);
      if (s2) {
        s2.onResize = null;
        s2.onSelectedChange = null;
        s2.onEmpty = null;
      }
    };
  }, [editor, onImageResize, onImageSelectedChange, onEmpty, blockId]);

  // Keep the ResizableImage NodeView informed of canvas zoom so its
  // resize handles counter-scale to remain a usable screen-pixel size.
  useEffect(() => {
    const s = getImageStorage(editor);
    if (s) s.zoom = zoom ?? 1;
  }, [editor, zoom]);

  useEffect(() => {
    if (editor && getEditorRef) getEditorRef(blockId, editor);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      editor?.destroy();
    };
  }, [editor, blockId, getEditorRef]);

  useEffect(() => {
    if (autoFocus && editor) {
      setTimeout(() => editor.commands.focus('end'), 50);
    }
  }, [autoFocus, editor]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !wrapRef.current?.contains(e.target as Node)) {
        closeSlash();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [slashOpen, closeSlash]);

  // Open the block menu programmatically (used by the touch "+" affordance,
  // so mobile users don't have to type "/" from the symbol keyboard).
  const openSlashMenu = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().run();
    let pos: { left: number; top: number } | null = null;
    try {
      const { from } = editor.state.selection;
      const c = editor.view.coordsAtPos(from);
      pos = { left: c.left, top: c.bottom + 4 };
    } catch { /* fall through to block-rect fallback */ }
    if (!pos && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      pos = { left: r.left, top: r.bottom + 4 };
    }
    slashRef.current = { open: true, idx: 0 };
    setSlashPos(pos);
    setSlashOpen(true);
    setSlashIdx(0);
  }, [editor]);

  return (
    <div ref={wrapRef} className="relative">
      {/* Touch-only "+" gutter button — opens the block menu by tap.
          Hidden on hover-capable (desktop) devices, which use "/". */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={openSlashMenu}
        className="hidden [@media(hover:none)]:flex absolute -left-7 top-0 h-7 w-6 items-center justify-center rounded text-lg leading-none text-muted/70 active:bg-surface"
        aria-label="Insert block"
        title="Insert block"
      >
        +
      </button>
      <EditorContent
        editor={editor}
        className="prose-base focus:outline-none min-h-[32px] text-text"
      />
      {slashOpen && mounted && createPortal(
        (() => {
          const MENU_W = 256;
          const MENU_H = 264;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
          const base = slashPos ?? { left: vw / 2 - MENU_W / 2, top: vh / 2 };
          // Clamp to viewport; flip above the caret if it would overflow.
          const left = Math.max(8, Math.min(base.left, vw - MENU_W - 8));
          const top =
            base.top + MENU_H > vh - 8
              ? Math.max(8, base.top - MENU_H - 24)
              : base.top;
          return (
            <div
              ref={menuRef}
              style={{ position: 'fixed', left, top, width: MENU_W }}
              className="z-[400] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
            >
              {SLASH_COMMANDS.map((cmd, i) => (
                <button
                  key={cmd.title}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); runSlash(editor, i); }}
                  onMouseEnter={() => { slashRef.current.idx = i; setSlashIdx(i); }}
                  className={`w-full px-3 py-2 text-left hover:bg-bg transition ${
                    i === slashIdx ? 'bg-bg' : ''
                  }`}
                >
                  <div className="text-sm font-medium text-text">{cmd.title}</div>
                  <div className="text-xs text-muted">{cmd.description}</div>
                </button>
              ))}
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
