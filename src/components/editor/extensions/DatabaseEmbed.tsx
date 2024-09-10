'use client';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface EmbedProperty {
  id: string;
  name: string;
  type: string;
  formula?: string | null;
}

interface EmbedPage {
  id: string;
  title: string;
  icon: string | null;
  properties: { property: EmbedProperty; value: any }[];
}

interface EmbedDatabase {
  id: string;
  name: string;
  properties: EmbedProperty[];
  pages: EmbedPage[];
}

interface WorkspaceDB {
  id: string;
  name: string;
}

// ── React NodeView component ───────────────────────────────────────────────

function DatabaseEmbedView({ node, updateAttributes }: { node: any; updateAttributes: (attrs: any) => void }) {
  const { databaseId } = node.attrs as { databaseId: string | null };
  const [data, setData] = useState<EmbedDatabase | null>(null);
  const [workspaceDbs, setWorkspaceDbs] = useState<WorkspaceDB[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!databaseId) return;
    setLoading(true);
    fetch(`/api/databases/${databaseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [databaseId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (databaseId) return;
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((ws: any[]) => setWorkspaceDbs(ws.flatMap((w) => (w.databases ?? []) as WorkspaceDB[])))
      .catch(() => {});
  }, [databaseId]);

  const updatePropValue = async (pageId: string, propertyId: string, value: any, type: string) => {
    const coerced = type === 'checkbox' ? Boolean(value) : (value === '' ? null : value);
    await fetch('/api/property-values', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, propertyId, value: coerced }),
    });
    load();
  };

  // ── Database picker ──
  if (!databaseId) {
    return (
      <NodeViewWrapper className="my-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-sm font-medium text-text mb-2">Embed a database</div>
          {workspaceDbs.length === 0 ? (
            <div className="text-sm text-muted">No databases found. Create one first.</div>
          ) : (
            <select
              className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              defaultValue=""
              onChange={(e) => { if (e.target.value) updateAttributes({ databaseId: e.target.value }); }}
            >
              <option value="" disabled>Choose a database…</option>
              {workspaceDbs.map((db) => (
                <option key={db.id} value={db.id}>{db.name}</option>
              ))}
            </select>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  if (loading && !data) {
    return (
      <NodeViewWrapper className="my-3">
        <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">Loading…</div>
      </NodeViewWrapper>
    );
  }

  if (!data) return <NodeViewWrapper className="my-3"><div className="text-sm text-muted text-center py-2">Could not load database</div></NodeViewWrapper>;

  const checkboxProps = data.properties.filter((p) => p.type === 'checkbox');
  const summaryProps = data.properties.filter((p) => p.type !== 'checkbox' && p.type !== 'formula').slice(0, 3);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-text"
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {data.name}
            <span className="text-xs text-muted font-normal">{data.pages.length} rows</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <Link
              href={`/database/${databaseId}`}
              className="flex items-center gap-1 text-xs text-accent hover:underline"
              target="_blank"
            >
              Open <ExternalLink size={11} />
            </Link>
          </div>
        </div>

        {!collapsed && (
          <div className="divide-y divide-border/40">
            {data.pages.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted text-center">No rows yet</div>
            ) : (
              data.pages.map((page) => {
                const pvMap: Record<string, any> = {};
                page.properties.forEach((pv) => { pvMap[pv.property.id] = pv.value; });
                const done = checkboxProps.length > 0 && !!pvMap[checkboxProps[0].id];

                return (
                  <div key={page.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-bg/60 transition-colors">
                    {checkboxProps.length > 0 && (
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() =>
                          updatePropValue(page.id, checkboxProps[0].id, !pvMap[checkboxProps[0].id], 'checkbox')
                        }
                        className="mt-0.5 w-4 h-4 cursor-pointer accent-accent shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium flex items-center gap-1.5 ${done ? 'line-through text-muted' : 'text-text'}`}>
                        <span>{page.icon ?? '📄'}</span>
                        <span className="truncate">{page.title}</span>
                      </div>
                      {summaryProps.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          {summaryProps.map((prop) => {
                            const val = pvMap[prop.id];
                            if (val == null || val === '') return null;
                            return (
                              <span key={prop.id} className="text-[11px] text-muted">
                                {prop.type === 'select'
                                  ? <span className="bg-bg border border-border rounded px-1.5 py-px">{String(val)}</span>
                                  : prop.type === 'checkbox'
                                  ? null
                                  : <span>{prop.name}: {String(val)}</span>
                                }
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ── TipTap Node definition ─────────────────────────────────────────────────

export const DatabaseEmbed = Node.create({
  name: 'databaseEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database-embed"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database-embed' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseEmbedView);
  },
});
