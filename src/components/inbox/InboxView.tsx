'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2, Sparkles, Plus, Archive, ArrowRight, ExternalLink } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { EntityIcon } from '@/components/icons/registry';

type Item = { id: string; title: string; icon?: string | null; createdAt: string; snippet: string };
type Workspace = { id: string; name: string; slug: string; icon?: string | null };
type Suggestion = { kind: string; title: string; summary: string; workspaceSlug: string };
type TriageState = {
  loading: boolean;
  suggestion?: Suggestion;
  targetWorkspace?: { id: string; name: string } | null;
  error?: string;
};

const KIND_EMOJI: Record<string, string> = {
  task: '✅',
  note: '📝',
  idea: '💡',
  job: '💼',
  expense: '💳',
  event: '📅',
};

export function InboxView() {
  const [items, setItems] = useState<Item[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [triage, setTriage] = useState<Record<string, TriageState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inbox');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? 'Could not load inbox');
      else {
        setItems(json.items ?? []);
        setWorkspaces(json.workspaces ?? []);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCapture = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setDraft('');
        await load();
      } else {
        toast.error('Could not capture');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }, [draft, load]);

  const runTriage = useCallback(async (id: string) => {
    setTriage((t) => ({ ...t, [id]: { loading: true } }));
    try {
      const res = await fetch('/api/inbox/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTriage((t) => ({ ...t, [id]: { loading: false, error: json.error ?? 'Triage failed' } }));
      } else {
        setTriage((t) => ({
          ...t,
          [id]: { loading: false, suggestion: json.suggestion, targetWorkspace: json.targetWorkspace },
        }));
      }
    } catch {
      setTriage((t) => ({ ...t, [id]: { loading: false, error: 'Network error' } }));
    }
  }, []);

  const removeLocal = (id: string) => setItems((list) => list.filter((i) => i.id !== id));

  const fileItem = useCallback(
    async (id: string, workspaceId: string, title?: string) => {
      removeLocal(id);
      const res = await fetch(`/api/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...(title ? { title } : {}) }),
      });
      if (res.ok) toast.success('Filed');
      else {
        toast.error('Could not file');
        load();
      }
    },
    [load]
  );

  const archiveItem = useCallback(
    async (id: string) => {
      removeLocal(id);
      await fetch(`/api/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: true }),
      });
      toast.undo('Item archived', async () => {
        await fetch(`/api/inbox/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archive: false }),
        });
        load();
      });
    },
    [load]
  );

  return (
    <div className="max-w-2xl mx-auto px-6 md:px-12 py-12">
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        <Inbox size={22} className="text-accent" /> Inbox
      </h1>
      <p className="text-muted mb-6 text-sm">
        Capture anything here, then triage it out to the right workspace.
      </p>

      {/* Quick capture */}
      <div className="rounded-xl border border-border p-3 mb-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addCapture();
          }}
          placeholder="Jot a thought, paste a link, dump a to-do…"
          rows={2}
          className="w-full bg-transparent text-sm text-text placeholder:text-muted focus:outline-none resize-y"
        />
        <div className="flex justify-end">
          <button
            onClick={addCapture}
            disabled={adding || !draft.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-60"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Capture
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32 gap-3 text-muted">
          <Loader2 size={20} className="animate-spin text-accent" />
          <span className="text-sm">Loading…</span>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted">Inbox zero. Capture something above to get started.</p>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const t = triage[item.id];
          const suggested = t?.suggestion;
          return (
            <li key={item.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{item.title}</div>
                  {item.snippet && item.snippet !== item.title && (
                    <div className="text-xs text-muted line-clamp-2 mt-0.5">{item.snippet}</div>
                  )}
                </div>
                <Link
                  href={`/page/${item.id}`}
                  className="p-1.5 rounded-lg text-muted hover:bg-surface shrink-0"
                  title="Open"
                >
                  <ExternalLink size={15} />
                </Link>
              </div>

              {suggested ? (
                <div className="mt-3 rounded-lg bg-surface border border-border p-3">
                  <div className="flex items-center gap-2 text-sm mb-1.5">
                    <span>{KIND_EMOJI[suggested.kind] ?? '📝'}</span>
                    <span className="font-medium">{suggested.title}</span>
                    <span className="text-xs uppercase tracking-wide text-muted">{suggested.kind}</span>
                  </div>
                  {suggested.summary && <p className="text-xs text-muted mb-2.5">{suggested.summary}</p>}
                  <div className="flex flex-wrap gap-2">
                    {t?.targetWorkspace ? (
                      <button
                        onClick={() => fileItem(item.id, t.targetWorkspace!.id, suggested.title)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80"
                      >
                        <ArrowRight size={13} /> File to {t.targetWorkspace.name}
                      </button>
                    ) : (
                      <span className="text-xs text-muted self-center">Suggestion: keep in inbox.</span>
                    )}
                    {workspaces
                      .filter((w) => w.id !== t?.targetWorkspace?.id)
                      .map((w) => (
                        <button
                          key={w.id}
                          onClick={() => fileItem(item.id, w.id, suggested.title)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-bg"
                        >
                          <EntityIcon icon={w.icon} kind="workspace" size={12} /> {w.name}
                        </button>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => runTriage(item.id)}
                    disabled={t?.loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-surface disabled:opacity-60"
                  >
                    {t?.loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-accent" />}
                    Triage
                  </button>
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => fileItem(item.id, w.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-surface text-muted"
                      title={`File to ${w.name}`}
                    >
                      <EntityIcon icon={w.icon} kind="workspace" size={12} /> {w.name}
                    </button>
                  ))}
                  <button
                    onClick={() => archiveItem(item.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:bg-surface ml-auto"
                    title="Archive"
                  >
                    <Archive size={13} /> Archive
                  </button>
                  {t?.error && <span className="text-xs text-red-500 w-full">{t.error}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
