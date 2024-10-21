'use client';
import { useEffect, useRef, useCallback } from 'react';
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

interface Props {
  blockId: string;
  initialContent: any;
  autoFocus?: boolean;
  onUpdate: (blockId: string, content: any) => void;
  onEmpty?: (blockId: string) => void; // called when block becomes empty + backspace
  getEditorRef?: (blockId: string, editor: any) => void;
}

export function CanvasTextBlock({
  blockId,
  initialContent,
  autoFocus,
  onUpdate,
  onEmpty,
  getEditorRef,
}: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (editor: any) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onUpdate(blockId, editor.getJSON());
      }, 600);
    },
    [blockId, onUpdate]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: ({ editor }) => scheduleSave(editor),
    editorProps: {
      handleKeyDown: (view, event) => {
        // Backspace on empty block → delete block
        if (event.key === 'Backspace' && onEmpty) {
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

  // Register editor ref with parent so parent can call getText() for summarize etc.
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

  return (
    <EditorContent
      editor={editor}
      className="prose-base focus:outline-none min-h-[32px] text-text"
    />
  );
}
