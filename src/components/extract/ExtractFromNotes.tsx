'use client';
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Check, AlertCircle, ChevronRight, FileText, Layers, ClipboardPaste } from 'lucide-react';
import type { ResolvedChange } from '@/app/api/extract/route';

type Database = { id: string; name: string };
type Workspace = { id: string; name: string; slug: string; icon: string | null; databases: Database[] };
type Page = { id: string; title: string; icon: string | null; updatedAt: string; workspaceId: string };
type ApplyResult = { ok: boolean; action: string; detail: string };
type SourceMode = 'paste' | 'page' | 'recent';

type Props = {
  onClose: () => void;
};

export function ExtractFromNotes({ onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [notes, setNotes] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedDbIds, setSelectedDbIds] = useState<Set<string>>(new Set());
  const [sourceMode, setSourceMode] = useState<SourceMode>('paste');
  const [pickedPageId, setPickedPageId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState('');
  const [recentPageIds, setRecentPageIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'input' | 'preview' | 'done'>('input');
  const [changes, setChanges] = useState<ResolvedChange[]>([]);
  const [enabledIdx, setEnabledIdx] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        setSelectedDbIds(new Set(data.flatMap((w: Workspace) => w.databases.map((d) => d.id))));
      })
      .catch(() => {});
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : []))
      .then((p: Page[]) => setPages(p))
      .catch(() => {});
  }, []);

  // Pages sorted by most recently updated, limited to 30 for the recent picker
  const pagesByRecent = useMemo(() => {
    return [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [pages]);
  const top30Recent = useMemo(() => pagesByRecent.slice(0, 30), [pagesByRecent]);

  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return pagesByRecent.slice(0, 12);
    return pagesByRecent
      .filter((p) => p.title.toLowerCase().includes(q))
      .slice(0, 20);
  }, [pageSearch, pagesByRecent]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function toggleDb(id: string) {
    setSelectedDbIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleChange(idx: number) {
    setEnabledIdx((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  async function handleExtract() {
    // Build payload from the active source mode
    let notesPart = '';
    let pageIdsPart: string[] = [];
    if (sourceMode === 'paste') {
      if (!notes.trim()) { setError('Paste some text first.'); return; }
      notesPart = notes;
    } else if (sourceMode === 'page') {
      if (!pickedPageId) { setError('Pick a page to extract from.'); return; }
      pageIdsPart = [pickedPageId];
    } else if (sourceMode === 'recent') {
      if (recentPageIds.size === 0) { setError('Select at least one recent page.'); return; }
      pageIdsPart = [...recentPageIds];
    }
    if (selectedDbIds.size === 0) { setError('Select at least one database.'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notesPart,
          pageIds: pageIdsPart,
          databaseIds: [...selectedDbIds],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Extraction failed');
      if (data.changes.length === 0) {
        setError('No relevant items found. Try selecting more databases or a different source.');
        setLoading(false);
        return;
      }
      setChanges(data.changes);
      setEnabledIdx(new Set(data.changes.map((_: unknown, i: number) => i)));
      setStep('preview');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleRecentPage(id: string) {
    setRecentPageIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Disable the Extract button if the current source mode has no input
  const canExtract = !loading && selectedDbIds.size > 0 && (
    (sourceMode === 'paste' && notes.trim().length > 0) ||
    (sourceMode === 'page' && pickedPageId !== null) ||
    (sourceMode === 'recent' && recentPageIds.size > 0)
  );

  async function handleApply() {
    const toApply = changes.filter((_, i) => enabledIdx.has(i));
    if (toApply.length === 0) { setError('Select at least one change to apply.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/extract/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: toApply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Apply failed');
      setResults(data.results);
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const allDatabases = workspaces.flatMap((w) =>
    w.databases.map((d) => ({ ...d, workspaceName: w.name }))
  );

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[8vh] bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[84vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 className="font-semibold text-sm">Extract from notes</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step: input */}
        {step === 'input' && (
          <div className="flex flex-col overflow-y-auto">
            <div className="p-5 space-y-4">
              {/* Source mode tabs */}
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">
                  Source
                </label>
                <div className="grid grid-cols-3 gap-1 bg-bg border border-border rounded-lg p-1">
                  {[
                    { id: 'paste' as const,  icon: ClipboardPaste, label: 'Paste text' },
                    { id: 'page' as const,   icon: FileText,       label: 'From a page' },
                    { id: 'recent' as const, icon: Layers,         label: 'Recent batch' },
                  ].map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => { setSourceMode(id); setError(''); }}
                      className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                        sourceMode === id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                      }`}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paste mode */}
              {sourceMode === 'paste' && (
                <textarea
                  autoFocus
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Paste or type your meeting notes here…"
                  rows={8}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none leading-relaxed"
                />
              )}

              {/* From a page mode */}
              {sourceMode === 'page' && (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                    placeholder="Search pages…"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1 border border-border rounded-lg bg-bg p-1">
                    {filteredPages.length === 0 ? (
                      <p className="text-xs text-muted text-center py-6">No pages match.</p>
                    ) : (
                      filteredPages.map((p) => (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors text-sm ${
                            pickedPageId === p.id ? 'bg-accent/15 text-text' : 'hover:bg-surface text-text'
                          }`}
                        >
                          <input
                            type="radio"
                            name="picked-page"
                            checked={pickedPageId === p.id}
                            onChange={() => setPickedPageId(p.id)}
                            className="accent-accent"
                          />
                          <span className="w-4 text-center">{p.icon ?? '📄'}</span>
                          <span className="truncate flex-1">{p.title || 'Untitled'}</span>
                          <span className="text-xs text-muted shrink-0">
                            {new Date(p.updatedAt).toLocaleDateString()}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Recent batch mode */}
              {sourceMode === 'recent' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>Select pages to sweep through ({recentPageIds.size} selected)</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setRecentPageIds(new Set(top30Recent.slice(0, 7).map((p) => p.id)))}
                        className="hover:text-text underline"
                      >
                        Last 7
                      </button>
                      <span>·</span>
                      <button
                        onClick={() => setRecentPageIds(new Set())}
                        className="hover:text-text underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-1 border border-border rounded-lg bg-bg p-1">
                    {top30Recent.length === 0 ? (
                      <p className="text-xs text-muted text-center py-6">No pages yet.</p>
                    ) : (
                      top30Recent.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer hover:bg-surface text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={recentPageIds.has(p.id)}
                            onChange={() => toggleRecentPage(p.id)}
                            className="accent-accent"
                          />
                          <span className="w-4 text-center">{p.icon ?? '📄'}</span>
                          <span className="truncate flex-1 text-text">{p.title || 'Untitled'}</span>
                          <span className="text-xs text-muted shrink-0">
                            {new Date(p.updatedAt).toLocaleDateString()}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              {allDatabases.length > 0 && (
                <div>
                  <label className="block text-xs text-muted mb-2 font-medium uppercase tracking-wide">
                    Databases to consider
                  </label>
                  <div className="space-y-1">
                    {allDatabases.map((db) => (
                      <label
                        key={db.id}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-bg cursor-pointer transition-colors text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDbIds.has(db.id)}
                          onChange={() => toggleDb(db.id)}
                          className="accent-accent"
                        />
                        <span className="text-text font-medium">{db.name}</span>
                        <span className="text-muted text-xs ml-auto">{db.workspaceName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            <div className="px-5 pb-5 flex justify-end gap-2 shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExtract}
                disabled={!canExtract}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
              >
                <Sparkles size={13} />
                {loading ? 'Extracting…' : 'Extract'}
              </button>
            </div>
          </div>
        )}

        {/* Step: preview */}
        {step === 'preview' && (
          <div className="flex flex-col overflow-hidden">
            <div className="px-5 pt-4 pb-2 shrink-0 flex items-center justify-between">
              <p className="text-xs text-muted uppercase tracking-wide font-medium">
                {changes.length} proposed change{changes.length !== 1 ? 's' : ''} — select to apply
              </p>
              <div className="flex gap-2 text-xs text-muted">
                <button
                  onClick={() => setEnabledIdx(new Set(changes.map((_, i) => i)))}
                  className="hover:text-text underline"
                >
                  all
                </button>
                <span>/</span>
                <button
                  onClick={() => setEnabledIdx(new Set())}
                  className="hover:text-text underline"
                >
                  none
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 pb-2 space-y-2">
              {changes.map((c, i) => {
                const enabled = enabledIdx.has(i);
                return (
                  <label
                    key={i}
                    className={`flex gap-3 rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                      enabled
                        ? 'border-border bg-bg'
                        : 'border-border/40 bg-surface opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleChange(i)}
                      className="mt-0.5 accent-accent shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                            c.action === 'update'
                              ? 'bg-blue-500/15 text-blue-500'
                              : 'bg-green-500/15 text-green-500'
                          }`}
                        >
                          {c.action}
                        </span>
                        <span className="font-medium text-text">{c.database}</span>
                        <ChevronRight size={12} className="text-muted" />
                        <span className="text-muted truncate">
                          {c.action === 'update' ? `"${c.pageTitle}"` : 'new row'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.action === 'create' && Boolean(c.row['Name']) && (
                          <span className="text-xs bg-surface border border-border rounded px-2 py-0.5 text-text">
                            <span className="text-muted">Name:</span> {String(c.row['Name'])}
                          </span>
                        )}
                        {Object.entries(c.action === 'update' ? c.changes : c.row)
                          .filter(([k]) => !(c.action === 'create' && k === 'Name'))
                          .map(([k, v]) => (
                            <span
                              key={k}
                              className="text-xs bg-surface border border-border rounded px-2 py-0.5 text-text"
                            >
                              <span className="text-muted">{k}:</span>{' '}
                              {v === null || v === undefined ? '—' : String(v)}
                            </span>
                          ))}
                      </div>
                      {c.action === 'create' && c.body && (
                        <p className="text-xs text-muted/90 italic mt-1.5 pl-1 border-l-2 border-accent/30 leading-relaxed">
                          {c.body}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {error && (
              <div className="mx-5 mb-2 flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="px-5 py-4 border-t border-border flex justify-between gap-2 shrink-0">
              <button
                onClick={() => { setStep('input'); setError(''); }}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={loading || enabledIdx.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
                >
                  <Check size={13} />
                  {loading ? 'Applying…' : `Apply ${enabledIdx.size > 0 ? enabledIdx.size : ''}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div className="flex flex-col overflow-hidden">
            <div className="px-5 pt-4 pb-2 shrink-0">
              <p className="text-xs text-muted uppercase tracking-wide font-medium">Results</p>
            </div>
            <div className="overflow-y-auto px-5 pb-2 space-y-1.5">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
                    r.ok
                      ? 'bg-green-500/10 border-green-500/20 text-green-600'
                      : 'bg-red-500/10 border-red-500/20 text-red-500'
                  }`}
                >
                  {r.ok ? <Check size={13} /> : <AlertCircle size={13} />}
                  {r.detail}
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 transition-opacity font-medium"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
