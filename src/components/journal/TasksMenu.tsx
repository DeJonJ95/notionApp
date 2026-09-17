'use client';
import { useEffect, useRef, useState } from 'react';
import { ListChecks, Download } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { liveEditors } from '@/lib/editorRegistry';
import { AgendaPanel, useAgenda } from './AgendaPanel';
import { PromoteTaskAffordance } from './PromoteTaskAffordance';
import { useLinkedTaskSync } from './useLinkedTaskSync';
import { insertPulledTasks, linkedTasks, pickTodoEditor } from './taskDoc';

// Journal header entry point for the task bridge: open rows across all
// databases, "pull" them into today's list, and the promote chip + checkbox
// sync that only make sense on today's entry.
export function TasksMenu({ pageId, date }: { pageId: string; date: string }) {
  const { agenda, loading, reload } = useAgenda(date);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLinkedTaskSync(true);

  useEffect(() => {
    if (!open) return;
    reload();
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, reload]);

  const pull = () => {
    const editors = liveEditors();
    const editor = pickTodoEditor(editors);
    if (!agenda || !editor) {
      toast.error('The journal editor is not ready yet');
      return;
    }
    const existing = new Set<string>();
    editors.forEach((e) => linkedTasks(e).forEach((_checked, id) => existing.add(id)));
    const items = agenda.items.map((i) => ({ pageId: i.id, title: i.title }));
    const n = insertPulledTasks(editor, items, existing);
    toast.success(n ? `Pulled ${n} task${n === 1 ? '' : 's'} into today` : 'All open tasks are already in today');
    setOpen(false);
  };

  const count = agenda?.items.length ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-accent hover:underline px-2 py-1 rounded hover:bg-bg transition-colors"
        title="Open rows across your databases"
      >
        <ListChecks size={13} /> Tasks
        {count > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold">{count}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 max-w-[90vw] rounded-xl border border-border bg-surface shadow-2xl p-3">
          <div className="max-h-72 overflow-y-auto">
            <AgendaPanel agenda={agenda} loading={loading} onChange={reload} />
          </div>
          <button
            onClick={pull}
            disabled={!count}
            className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-md bg-accent text-white text-xs font-medium py-1.5 disabled:opacity-40"
          >
            <Download size={12} /> Pull into today’s to-do list
          </button>
        </div>
      )}
      <PromoteTaskAffordance targets={agenda?.databases ?? []} pageId={pageId} date={date} onPromoted={reload} />
    </div>
  );
}
