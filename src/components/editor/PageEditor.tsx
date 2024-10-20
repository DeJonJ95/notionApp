'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Star, Trash2, Sparkles, ImageIcon, Database, Maximize2, Minimize2, Mic, ClipboardList, LayoutDashboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { OrganizeModal } from '@/components/extract/OrganizeModal';
import { DatabaseEmbed } from '@/components/editor/extensions/DatabaseEmbed';
import { DragHandleOverlay } from '@/components/editor/extensions/DragHandle';
import { HeadingCollapseExtension, CollapsibleHeadingOverlay } from '@/components/editor/extensions/CollapsibleHeading';
import { TableOfContents } from '@/components/editor/extensions/TableOfContents';
import { AudioRecorder } from '@/components/editor/AudioRecorder';
import { SummarizeModal } from '@/components/editor/SummarizeModal';
import { CanvasMode } from '@/components/editor/CanvasMode';

type PageData = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  isFavorite: boolean;
};

type CommandItem = {
  title: string;
  description: string;
  action: (editor: any) => void;
};

export function PageEditor({
  page,
  initialContent,
}: {
  page: PageData;
  initialContent: any | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [favorite, setFavorite] = useState(page.isFavorite);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('saved');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [isCanvas, setIsCanvas] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null);
  // Shadow ref keeps slash state accessible inside the editor's stable (stale-closure) keydown handler.
  // React state setters are stable so writing them is fine; reading state is not — use this ref instead.
  const slashRef = useRef({ open: false, cmd: 0, range: null as { from: number; to: number } | null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const hasMountedRef = useRef(false);
  const lastSavedRef = useRef<{ title: string; content: any }>({
    title: page.title,
    content: initialContent,
  });

  const commandItems: CommandItem[] = useMemo(
    () => [
      {
        title: 'Text',
        description: 'Continue writing with normal text.',
        action: (editor) => editor.chain().focus().setParagraph().run(),
      },
      {
        title: 'Heading 1',
        description: 'Large section title.',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        title: 'Heading 2',
        description: 'Smaller section title.',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        title: 'Heading 3',
        description: 'Subsection heading.',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        title: 'To-do list',
        description: 'Add a checklist item.',
        action: (editor) => editor.chain().focus().toggleTaskList().run(),
      },
      {
        title: 'Bulleted list',
        description: 'Start a bulleted list.',
        action: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
      {
        title: 'Numbered list',
        description: 'Start a numbered list.',
        action: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        title: 'Quote',
        description: 'Add a quote block.',
        action: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        title: 'Code block',
        description: 'Insert a code block.',
        action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        title: 'Table',
        description: 'Insert a table.',
        action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        title: 'Image',
        description: 'Upload an image from your device.',
        action: () => imageInputRef.current?.click(),
      },
      {
        title: 'Embed database',
        description: 'Embed a live database view inside this note.',
        action: (editor) => editor.chain().focus().insertContent({ type: 'databaseEmbed', attrs: { databaseId: null } }).run(),
      },
    ],
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      HeadingCollapseExtension,
      Placeholder.configure({ placeholder: "Press '/' for commands, or just start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      DatabaseEmbed,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent ?? '',
    editorProps: {
      attributes: {
        class: 'prose-base focus:outline-none min-h-[320px] pb-10',
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            const { from, $from } = view.state.selection;
            // parentOffset === 0 means cursor is at the start of its block (empty line, new paragraph, etc.)
            const atBlockStart = $from.parentOffset === 0;
            const before = from > 0 ? view.state.doc.textBetween(from - 1, from, '\0', '\0') : '';
            if (atBlockStart || /\s/.test(before)) {
              event.preventDefault();
              slashRef.current = { open: true, cmd: 0, range: { from, to: from } };
              setSlashOpen(true);
              setSlashRange({ from, to: from });
              setSelectedCommand(0);
              return true;
            }
          }

          // Read from ref — state values here are the stale initial-render snapshot
          if (slashRef.current.open) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              const next = (slashRef.current.cmd + 1) % commandItems.length;
              slashRef.current.cmd = next;
              setSelectedCommand(next);
              return true;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              const prev = slashRef.current.cmd === 0 ? commandItems.length - 1 : slashRef.current.cmd - 1;
              slashRef.current.cmd = prev;
              setSelectedCommand(prev);
              return true;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const command = commandItems[slashRef.current.cmd];
              if (command && editor) {
                if (slashRef.current.range) editor.commands.deleteRange(slashRef.current.range);
                command.action(editor);
              }
              slashRef.current = { open: false, cmd: 0, range: null };
              setSlashOpen(false);
              setSelectedCommand(0);
              return true;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              slashRef.current.open = false;
              setSlashOpen(false);
              return true;
            }
          }

          return false;
        },
      },
    },
    onUpdate: () => scheduleSave(),
    immediatelyRender: false,
  });

  const uploadImage = useCallback(async (file: File) => {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    if (!res.ok) return;
    const { uploadUrl, publicUrl } = await res.json();
    await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    editor?.chain().focus().setImage({ src: publicUrl }).run();
  }, [editor]);

  const executeSlashCommand = (action: (editor: any) => void) => {
    if (!editor) return;
    const range = slashRef.current.range ?? slashRange;
    if (range) editor.commands.deleteRange(range);
    action(editor);
    slashRef.current = { open: false, cmd: 0, range: null };
    setSlashOpen(false);
    setSelectedCommand(0);
  };

  const save = useCallback(
    async (
      data: { title?: string; icon?: string | null; isFavorite?: boolean; content?: any },
      { refresh = false }: { refresh?: boolean } = {}
    ) => {
      setSavingState('saving');
      try {
        const res = await fetch(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          setSavingState('saved');
          // Only refresh server components when metadata visible in the sidebar
          // (icon, title, favorite) changes — not on every content auto-save.
          if (refresh) router.refresh();
        }
      } catch {
        setSavingState('idle');
      }
    },
    [page.id, router]
  );

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSavingState('saving');
    saveTimer.current = setTimeout(() => {
      const content = editor?.getJSON();
      const payload: any = {};
      if (title !== lastSavedRef.current.title) payload.title = title;
      if (JSON.stringify(content) !== JSON.stringify(lastSavedRef.current.content))
        payload.content = content;
      if (Object.keys(payload).length > 0) {
        save(payload);
        lastSavedRef.current = { title, content };
      } else {
        setSavingState('saved');
      }
    }, 800);
  }, [editor, title, save]);

  useEffect(() => {
    // Skip the initial mount — only schedule a save when the title actually changes.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scheduleSave();
  }, [title, scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!slashOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setSlashOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [slashOpen]);

  const toggleFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    await save({ isFavorite: next }, { refresh: true });
  };

  const changeIcon = async () => {
    const newIcon = prompt('Enter an emoji', icon ?? '📄');
    if (newIcon !== null) {
      setIcon(newIcon || null);
      await save({ icon: newIcon || null }, { refresh: true });
    }
  };

  const deletePage = async () => {
    if (!window.confirm(`Delete "${title || 'Untitled'}"? This cannot be undone.`)) return;
    await fetch(`/api/pages/${page.id}`, { method: 'DELETE' });
    router.push('/');
    router.refresh();
  };

  // Single return below — do NOT split into two JSX trees based on isFullscreen.
  // Switching trees unmounts TipTap's DOM and drops all node views (DatabaseEmbed, etc.).
  // Instead, the outer shell changes classes only, keeping the editor subtree stable.
  return (
    <div className={isFullscreen ? 'fixed inset-0 z-50 bg-bg flex overflow-hidden' : ''}>
      <div className={isFullscreen ? 'flex-1 overflow-y-auto' : ''}>
    <div className={isFullscreen ? 'w-full px-8 md:px-16 py-10' : 'max-w-3xl mx-auto px-6 md:px-12 py-10'}>
      <div className="flex items-center justify-between mb-4 text-xs text-muted">
        <span>
          {savingState === 'saving' && 'Saving…'}
          {savingState === 'saved' && 'Saved'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            className="p-1.5 rounded hover:bg-surface"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={toggleFavorite}
            className="p-1.5 rounded hover:bg-surface"
            aria-label="Favorite"
          >
            <Star
              size={16}
              className={favorite ? 'fill-yellow-400 stroke-yellow-500' : ''}
            />
          </button>
          <button
            onClick={deletePage}
            className="p-1.5 rounded hover:bg-surface text-muted hover:text-red-500"
            aria-label="Delete page"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <button
        onClick={changeIcon}
        className="text-5xl mb-3 hover:bg-surface rounded p-2 -ml-2 transition"
      >
        {icon ?? '📄'}
      </button>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="w-full text-4xl font-bold bg-transparent outline-none placeholder:text-muted/40 mb-6"
      />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {commandItems.slice(1, 6).map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => executeSlashCommand(item.action)}
            className="rounded-lg border border-border px-3 py-1 hover:bg-surface"
          >
            {item.title}
          </button>
        ))}
        <div className="w-px bg-border mx-1 self-stretch" />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 hover:bg-surface"
        >
          <ImageIcon size={13} />
          Image
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().insertContent({ type: 'databaseEmbed', attrs: { databaseId: null } }).run()}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 hover:bg-surface"
        >
          <Database size={13} />
          Embed DB
        </button>
        <div className="w-px bg-border mx-1 self-stretch" />
        <button
          type="button"
          onClick={() => setRecordOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 transition-colors ${
            recordOpen
              ? 'bg-red-500/10 border-red-400 text-red-500'
              : 'border-border hover:bg-surface'
          }`}
        >
          <Mic size={13} />
          Record
        </button>
        <button
          type="button"
          onClick={() => setSummarizeOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 hover:bg-surface text-accent"
        >
          <ClipboardList size={13} />
          Summarize
        </button>
        <button
          type="button"
          onClick={() => setOrganizeOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 hover:bg-surface text-accent"
        >
          <Sparkles size={13} />
          Organize
        </button>
        <div className="w-px bg-border mx-1 self-stretch" />
        <button
          type="button"
          onClick={() => setIsCanvas(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 hover:bg-surface"
        >
          <LayoutDashboard size={13} />
          Canvas
        </button>
      </div>

      {/* Audio recorder panel — inline below toolbar */}
      {recordOpen && editor && (
        <div className="mb-4">
          <AudioRecorder editor={editor} onClose={() => setRecordOpen(false)} />
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadImage(file);
          e.target.value = '';
        }}
      />

      {organizeOpen && editor && (
        <OrganizeModal
          rawText={editor.getText()}
          onClose={() => setOrganizeOpen(false)}
          onAccept={(html) => {
            editor.commands.setContent(html);
            scheduleSave();
          }}
        />
      )}

      {summarizeOpen && editor && (
        <SummarizeModal
          rawText={editor.getText()}
          onClose={() => setSummarizeOpen(false)}
          onInsert={(html) => {
            editor.chain().focus().setTextSelection(0).insertContentAt(0, html).run();
            scheduleSave();
          }}
        />
      )}

      <div className="relative">
        {slashOpen && (
          <div
            ref={menuRef}
            className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
          >
            {commandItems.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => executeSlashCommand(item.action)}
                className={`w-full px-4 py-3 text-left hover:bg-bg transition ${
                  selectedCommand === index ? 'bg-bg' : ''
                }`}
              >
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted">{item.description}</div>
              </button>
            ))}
          </div>
        )}

        <div style={isFullscreen ? { minHeight: 'calc(100vh - 260px)' } : undefined}>
          <EditorContent editor={editor} />
        </div>
        {editor && <DragHandleOverlay editor={editor} />}
        {editor && <CollapsibleHeadingOverlay editor={editor} />}
      </div>
    </div>
    </div>
    {editor && <TableOfContents editor={editor} isFullscreen={isFullscreen} />}
    {isCanvas && editor && (
      <CanvasMode
        initialDoc={editor.getJSON()}
        pageId={page.id}
        onExit={() => setIsCanvas(false)}
        onSave={(doc) => {
          editor.commands.setContent(doc);
          scheduleSave();
        }}
      />
    )}
  </div>
  );
}
