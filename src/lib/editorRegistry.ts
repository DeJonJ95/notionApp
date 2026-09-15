import type { Editor } from '@tiptap/react';

// Live TipTap instances on the current screen. CanvasTextBlock registers each
// one so features outside the editor tree (the journal task bridge) can find
// the editor that owns a DOM node without threading callbacks through the
// 2900-line canvas editor.
const editors = new Set<Editor>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function trackEditor(editor: Editor | null, cleanup: () => void): () => void {
  if (editor) {
    editors.add(editor);
    notify();
  }
  return () => {
    if (editor && editors.delete(editor)) notify();
    cleanup();
  };
}

export function liveEditors(): Editor[] {
  return Array.from(editors).filter((e) => !e.isDestroyed);
}

export function editorForElement(el: Element | null): Editor | null {
  if (!el) return null;
  return liveEditors().find((e) => e.view.dom.contains(el)) ?? null;
}

export function subscribeEditors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
