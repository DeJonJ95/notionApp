'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';

type PageData = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  isFavorite: boolean;
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ title: string; content: any }>({
    title: page.title,
    content: initialContent,
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Press '/' for commands, or just start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
    ],
    content: initialContent ?? '',
    editorProps: {
      attributes: {
        class: 'prose-base focus:outline-none',
      },
    },
    onUpdate: () => scheduleSave(),
    immediatelyRender: false,
  });

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
      {/* Toolbar */}
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

      {/* Icon */}
      <button
        onClick={changeIcon}
        className="text-5xl mb-3 hover:bg-surface rounded p-2 -ml-2 transition"
      >
        {icon ?? '📄'}
      </button>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="w-full text-4xl font-bold bg-transparent outline-none placeholder:text-muted/40 mb-6"
      />

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
