'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    ],
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: "Press '/' for commands, or just start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
    ],
    content: initialContent ?? '',
    editorProps: {
      attributes: {
        class: 'prose-base focus:outline-none min-h-[320px] pb-10',
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            const { from } = view.state.selection;
            const before = from > 0 ? view.state.doc.textBetween(from - 1, from, '\0', '\0') : '';
            if (from === 0 || /\s/.test(before)) {
              event.preventDefault();
              setSlashOpen(true);
              setSlashRange({ from, to: from });
              setSelectedCommand(0);
              return true;
            }
          }

          if (slashOpen) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelectedCommand((current) => (current + 1) % commandItems.length);
              return true;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedCommand((current) =>
                current === 0 ? commandItems.length - 1 : current - 1
              );
              return true;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const command = commandItems[selectedCommand];
              if (command) executeSlashCommand(command.action);
              return true;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
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

  const executeSlashCommand = (action: (editor: any) => void) => {
    if (!editor) return;
    if (slashRange) {
      editor.commands.deleteRange(slashRange);
    }
    action(editor);
    setSlashOpen(false);
    setSelectedCommand(0);
  };

  const save = useCallback(
    async (data: { title?: string; icon?: string | null; isFavorite?: boolean; content?: any }) => {
      setSavingState('saving');
      try {
        const res = await fetch(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) setSavingState('saved');
        router.refresh();
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
    await save({ isFavorite: next });
  };

  const changeIcon = async () => {
    const newIcon = prompt('Enter an emoji', icon ?? '📄');
    if (newIcon !== null) {
      setIcon(newIcon || null);
      await save({ icon: newIcon || null });
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-10">
      <div className="flex items-center justify-between mb-4 text-xs text-muted">
        <span>
          {savingState === 'saving' && 'Saving…'}
          {savingState === 'saved' && 'Saved'}
        </span>
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
      </div>

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

        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
