'use client';
import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { liveEditors, subscribeEditors } from '@/lib/editorRegistry';
import { toast } from '@/components/ui/feedback';
import { linkedTasks } from './taskDoc';

const DEBOUNCE_MS = 400;

async function patchDone(pageId: string, done: boolean) {
  try {
    const res = await fetch(`/api/tasks/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    const json = (await res.json().catch(() => ({}))) as { updated?: boolean; value?: unknown };
    if (!res.ok) toast.error('Could not update the task row');
    else if (json.updated && typeof json.value === 'string') toast.success(`Task marked ${json.value}`);
  } catch {
    toast.error('Network error updating task');
  }
}

// Checking a linked journal to-do flips the row's Status; unchecking reopens
// it. Seeds from the current doc so loading a page never fires writes.
export function useLinkedTaskSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const known = new Map<string, boolean>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const detach = new Map<Editor, () => void>();

    const seed = (editor: Editor) => {
      linkedTasks(editor).forEach((checked, id) => {
        if (!known.has(id)) known.set(id, checked);
      });
    };

    const watch = (editor: Editor) => () => {
      linkedTasks(editor).forEach((checked, id) => {
        if (!known.has(id) || known.get(id) === checked) {
          known.set(id, checked);
          return;
        }
        known.set(id, checked);
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => patchDone(id, checked), DEBOUNCE_MS));
      });
    };

    const attach = () => {
      for (const editor of liveEditors()) {
        if (detach.has(editor)) continue;
        seed(editor);
        const handler = watch(editor);
        editor.on('update', handler);
        detach.set(editor, () => editor.off('update', handler));
      }
    };

    attach();
    const unsubscribe = subscribeEditors(attach);
    return () => {
      unsubscribe();
      detach.forEach((off) => off());
      timers.forEach((t) => clearTimeout(t));
    };
  }, [enabled]);
}
