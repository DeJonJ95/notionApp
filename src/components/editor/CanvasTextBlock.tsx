'use client';
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './ResizableImage';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

interface SlashCmd {
  title: string;
  description: string;
  run: (editor: any) => void;
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
];

interface Props {
  blockId: string;
  initialContent: any;
  autoFocus?: boolean;
  onUpdate: (blockId: string, content: any) => void;
  onEmpty?: (blockId: string) => void;
  getEditorRef?: (blockId: string, editor: any) => void;
  onFocusChange?: (blockId: string | null) => void;
  // Called by the embedded ResizableImage when the user resizes an image
  // inside this block. Lets the parent canvas block follow the image width.
  onImageResize?: (width: number, isFinal: boolean) => void;
}

export function CanvasTextBlock({
  blockId,
  initialContent,
  autoFocus,
  onUpdate,
  onEmpty,
  getEditorRef,
  onFocusChange,
  onImageResize,
}: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  // Mirror state in a ref so the editor's keydown closure (created once at
  // mount) can always read the latest values without going stale.
  const slashRef = useRef({ open: false, idx: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
    if (cmd && editor) cmd.run(editor);
    closeSlash();
  }, [closeSlash]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
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
            slashRef.current = { open: true, idx: 0 };
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

  // Expose the image-resize callback to the ResizableImage NodeView
  useEffect(() => {
    if (!editor) return;
    if (editor.storage?.image) {
      editor.storage.image.onResize = onImageResize ?? null;
    }
    return () => {
      if (editor.storage?.image) editor.storage.image.onResize = null;
    };
  }, [editor, onImageResize]);

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

  return (
    <div ref={wrapRef} className="relative">
      <EditorContent
        editor={editor}
        className="prose-base focus:outline-none min-h-[32px] text-text"
      />
      {slashOpen && (
        <div
          ref={menuRef}
          className="absolute z-30 mt-1 w-64 rounded-xl border border-border bg-surface shadow-lg overflow-hidden max-h-64 overflow-y-auto"
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
      )}
    </div>
  );
}
