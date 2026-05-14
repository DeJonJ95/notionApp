'use client';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';

// Dynamic import breaks the circular dependency:
// PageEditor → DatabaseEmbed → DatabaseView → PageEditor (dynamic)
const DatabaseViewEmbed = dynamic(
  () => import('@/components/database/DatabaseView').then((m) => m.DatabaseView),
  { ssr: false, loading: () => <div className="px-4 py-6 text-sm text-muted text-center">Loading…</div> }
);

interface WorkspaceDB {
  id: string;
  name: string;
}

// ── React NodeView component ───────────────────────────────────────────────

function DatabaseEmbedView({ node, updateAttributes }: { node: any; updateAttributes: (attrs: any) => void }) {
  const { databaseId } = node.attrs as { databaseId: string | null };
  const [data, setData] = useState<any | null>(null);
  const [workspaceDbs, setWorkspaceDbs] = useState<WorkspaceDB[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  // Fetch workspace databases only for the picker
  useEffect(() => {
    if (databaseId) return;
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((ws: any[]) => setWorkspaceDbs(ws.flatMap((w) => (w.databases ?? []) as WorkspaceDB[])))
      .catch(() => {});
  }, [databaseId]);

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

  if (!data) {
    return (
      <NodeViewWrapper className="my-3">
        <div className="text-sm text-muted text-center py-2">Could not load database</div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-sm font-semibold text-text hover:text-accent transition-colors"
          >
            {collapsed ? '▶' : '▼'} {data.name}
            <span className="ml-2 text-xs text-muted font-normal">{data.pages?.length ?? 0} rows</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => updateAttributes({ databaseId: null })}
              className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
              title="Change database"
            >
              <X size={12} />
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
          <div className="overflow-x-auto">
            <DatabaseViewEmbed database={data} onUpdate={load} />
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
