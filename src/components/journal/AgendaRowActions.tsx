'use client';
import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import type { AgendaItem } from '@/lib/agenda';

type Outcome = { ok: boolean; error?: string };

async function patchJson(url: string, body: unknown): Promise<Outcome> {
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { ok: res.ok, error: typeof json.error === 'string' ? json.error : undefined };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

const ICON_BUTTON = 'p-1 rounded text-muted hover:text-text hover:bg-border/60 disabled:opacity-40';

export function AgendaRowActions({
  item, statusOptions, onChange,
}: {
  item: AgendaItem;
  statusOptions: string[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<Outcome>, success: string | null) => {
    setBusy(true);
    const result = await task();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? 'Could not update the row');
      return;
    }
    if (success) toast.success(success);
    onChange();
  };

  const setStatus = (status: string) =>
    run(() => patchJson(`/api/tasks/${item.id}`, { status }), `Marked ${status}`);
  const markDone = () => run(() => patchJson(`/api/tasks/${item.id}`, { done: true }), 'Marked done');
  const archive = () =>
    run(async () => {
      const result = await patchJson(`/api/pages/${item.id}`, { isArchived: true });
      if (result.ok) {
        toast.undo(`Deleted "${item.title || 'Untitled'}"`, () => {
          void patchJson(`/api/pages/${item.id}`, { isArchived: false }).then(onChange);
        });
      }
      return result;
    }, null);

  const knownStatus = item.status != null && statusOptions.includes(item.status);

  return (
    <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
      {statusOptions.length > 0 ? (
        <select
          value={knownStatus ? item.status ?? '' : ''}
          disabled={busy}
          aria-label="Status"
          onChange={(e) => e.target.value && setStatus(e.target.value)}
          className="max-w-[7rem] rounded border border-border bg-bg px-1 py-0.5 text-xs text-text disabled:opacity-40"
        >
          {!knownStatus && <option value="">Status…</option>}
          {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <button onClick={markDone} disabled={busy} title="Mark done" aria-label="Mark done" className={ICON_BUTTON}>
          <Check size={14} />
        </button>
      )}
      <button onClick={archive} disabled={busy} title="Delete" aria-label="Delete" className={ICON_BUTTON}>
        <Trash2 size={14} />
      </button>
    </span>
  );
}
