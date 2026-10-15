'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightToLine, Loader2, Sparkles } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { AgendaTarget } from '@/lib/agenda';
import { editorForElement } from '@/lib/editorRegistry';
import { toast } from '@/components/ui/feedback';
import { todoKey } from '@/lib/assist/todoKey';
import { linkifyTaskItem, rowIdOf, taskItemAt } from './taskDoc';
import { AssistPanel } from './assist/AssistPanel';
import type { AssistTodo } from './assist/useAssist';

const LAST_DB_KEY = 'kove:promote-db';
const BAR_W = 160;

type Target = { li: Element; editor: Editor; top: number; left: number; linked: boolean; key: string };

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

// Just past the end of the to-do's own text; the <li> itself spans the page width.
function chipSpot(li: Element): { top: number; left: number } {
  const p = li.querySelector('p');
  const range = document.createRange();
  range.selectNodeContents(p ?? li);
  const text = range.getBoundingClientRect();
  const top = li.getBoundingClientRect().top;
  return { top, left: Math.max(0, Math.min(text.right + 12, window.innerWidth - BAR_W - 8)) };
}

// The caret's enclosing to-do, unless it is empty. TaskItem's node view renders
// a bare <li data-checked>; only the parent list carries data-type="taskList".
function locate(): Target | null {
  const anchor = document.getSelection()?.anchorNode ?? null;
  const el = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
  const li = el?.closest('ul[data-type="taskList"] > li') ?? null;
  const editor = editorForElement(li);
  if (!li || !editor) return null;
  const text = taskItemAt(editor, li)?.node.firstChild?.textContent.trim() ?? '';
  if (text.length < 2) return null;
  return { li, editor, ...chipSpot(li), linked: !!li.querySelector('a[href^="/page/"]'), key: todoKey(text) };
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

// Which to-dos on this page already have an assistant thread, so their chip can say so.
function useThreadKeys(pageId: string) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const reload = useCallback(() => {
    fetch(`/api/assist?pageId=${encodeURIComponent(pageId)}`)
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((d: { threads?: { todoKey: string }[] }) => setKeys(new Set((d.threads ?? []).map((t) => t.todoKey))))
      .catch(() => {});
  }, [pageId]);
  useEffect(reload, [reload]);
  return { keys, reload };
}

function useCaretTodo(paused: boolean) {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    if (paused) return;
    const update = () => setTarget(locate());
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [paused]);
  return [target, setTarget] as const;
}

type Promote = { targets: AgendaTarget[]; onPromoted?: () => void };

type Props = { pageId: string; date: string; promote?: Promote };

// Chips beside the to-do under the caret: Assist on any journal day, and Task
// (turn it into a database row) on today's entry for to-dos not yet linked.
export function TodoChips({ pageId, date, promote }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assist, setAssist] = useState<AssistTodo | null>(null);
  const [target, setTarget] = useCaretTodo(open);
  const threads = useThreadKeys(pageId);
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

  const startAssist = () => {
    const hit = target ? taskItemAt(target.editor, target.li) : null;
    const text = hit?.node.firstChild?.textContent.trim();
    if (!hit || !text) return;
    setAssist({ pageId, date, text, linkedRowId: rowIdOf(hit.node) });
  };

  const promoteTo = async (db: AgendaTarget) => {
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
      promote?.onPromoted?.();
    } else {
      toast.error(json.error ?? 'Could not create the task');
    }
    setBusy(false);
    setOpen(false);
    setTarget(null);
  };

  const panel = assist && <AssistPanel todo={assist} onClose={() => { setAssist(null); threads.reload(); }} />;
  if (!target || assist) return panel || null;
  const chip = 'flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-accent shadow hover:bg-bg disabled:opacity-60';
  return createPortal(
    <div ref={rootRef} style={{ position: 'fixed', top: target.top, left: target.left, width: BAR_W }} className="z-[400]">
      <div className="flex gap-1">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={startAssist} className={chip} title="Get help with this to-do">
          <Sparkles size={11} /> {threads.keys.has(target.key) ? 'Open' : 'Assist'}
        </button>
        {promote && !target.linked && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)} disabled={busy} className={chip} title="Turn this to-do into a database row">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightToLine size={11} />} Task
          </button>
        )}
      </div>
      {open && promote && <TargetPicker targets={promote.targets} onPick={promoteTo} />}
    </div>,
    document.body
  );
}
