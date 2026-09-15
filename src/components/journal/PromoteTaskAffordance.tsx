'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightToLine, Loader2 } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { AgendaTarget } from '@/lib/agenda';
import { editorForElement } from '@/lib/editorRegistry';
import { toast } from '@/components/ui/feedback';
import { linkifyTaskItem, taskItemAt } from './taskDoc';

const LAST_DB_KEY = 'kove:promote-db';
const CHIP_W = 120;

type Target = { li: Element; editor: Editor; top: number; left: number };

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_DB_KEY);
  } catch {
    return null;
  }
}

function writeLast(id: string) {
  try {
    localStorage.setItem(LAST_DB_KEY, id);
  } catch {
    /* private mode */
  }
}

// The caret's enclosing to-do, unless it is already a linked row or empty.
function locate(): Target | null {
  const anchor = document.getSelection()?.anchorNode ?? null;
  const el = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
  const li = el?.closest('li[data-type="taskItem"]') ?? null;
  const editor = editorForElement(li);
  if (!li || !editor) return null;
  if (li.querySelector('a[href^="/page/"]') || !li.textContent?.trim()) return null;
  const r = li.getBoundingClientRect();
  return { li, editor, top: r.top, left: Math.min(r.right + 8, window.innerWidth - CHIP_W - 8) };
}

type CreateInput = { databaseId: string; title: string; dueDate: string; sourcePageId: string };

async function createRow(input: CreateInput): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    return res.ok ? json : { error: json.error ?? 'Could not create the task' };
  } catch {
    return { error: 'Network error' };
  }
}

function TargetPicker({ targets, onPick }: { targets: AgendaTarget[]; onPick: (db: AgendaTarget) => void }) {
  const last = readLast();
  const ordered = [...targets].sort((a, b) => Number(b.id === last) - Number(a.id === last));
  return (
    <div className="mt-1 w-56 rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
      {ordered.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted">
          No task databases yet. Create one from the Project Tracker template first.
        </p>
      ) : (
        ordered.map((db) => (
          <button
            key={db.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(db)}
            className="w-full px-3 py-2 text-left hover:bg-bg"
          >
            <div className="text-sm text-text truncate">{db.name}</div>
            <div className="text-xs text-muted truncate">{db.workspaceName}</div>
          </button>
        ))
      )}
    </div>
  );
}

type Props = {
  targets: AgendaTarget[];
  pageId: string;
  date: string;
  onPromoted?: () => void;
};

export function PromoteTaskAffordance({ targets, pageId, date, onPromoted }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Open picker: outside click or Escape closes it and re-arms tracking.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const update = () => setTarget(locate());
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const promote = async (db: AgendaTarget) => {
    const title = target ? taskItemAt(target.editor, target.li)?.node.firstChild?.textContent.trim() : '';
    if (!target || !title) return;
    setBusy(true);
    const json = await createRow({ databaseId: db.id, title, dueDate: date, sourcePageId: pageId });
    if (json.id) {
      const hit = taskItemAt(target.editor, target.li);
      if (hit) linkifyTaskItem(target.editor, hit.pos, `/page/${json.id}`);
      else toast.error('Task created, but the to-do could not be linked');
      writeLast(db.id);
      toast.success(`Added to ${db.name}`);
      onPromoted?.();
    } else {
      toast.error(json.error ?? 'Could not create the task');
    }
    setBusy(false);
    setOpen(false);
    setTarget(null);
  };

  if (!target) return null;
  return createPortal(
    <div ref={rootRef} style={{ position: 'fixed', top: target.top, left: target.left, width: CHIP_W }} className="z-[400]">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-accent shadow hover:bg-bg disabled:opacity-60"
        title="Turn this to-do into a database row"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightToLine size={11} />} Task
      </button>
      {open && <TargetPicker targets={targets} onPick={promote} />}
    </div>,
    document.body
  );
}
