'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronRight, ChevronDown, Plus, Trash2, LayoutGrid, Edit3, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Workspace = { id: string; name: string; slug: string; icon: string | null };
type Database = { id: string; name: string };
type Page = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  workspaceId: string;
  position: number;
};

export function PageTree({
  workspace,
  pages,
  databases = [],
  onChange,
  onNavigate,
}: {
  workspace: Workspace;
  pages: Page[];
  databases?: Database[];
  onChange: () => void;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(workspace.name);
  const router = useRouter();
  const pathname = usePathname();
  const topLevel = pages
    .filter((p) => p.parentId === null)
    .sort((a, b) => a.position - b.position);

  const createPage = async (parentId: string | null = null) => {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.id, parentId }),
    });
    if (res.ok) {
      const page = await res.json();
      onChange();
      router.push(`/page/${page.id}`);
    }
  };

  const saveRename = async () => {
    const name = renameValue.trim();
    if (!name || name === workspace.name) { setRenaming(false); return; }
    await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    onChange();
  };

  const changeIcon = async () => {
    const next = window.prompt('Workspace icon (emoji, or blank to clear)', workspace.icon ?? '');
    if (next === null) return;
    await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: next.trim() || null }),
    });
    onChange();
  };

  const deleteWorkspace = async () => {
    const confirmText = `Delete workspace "${workspace.name}"?\n\nThis permanently removes ALL its pages, databases, and blocks. Cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'Failed to delete workspace');
      return;
    }
    onChange();
    // If the user was inside this workspace's pages, kick them home
    if (pathname?.startsWith(`/workspace/${workspace.slug}`)) {
      router.push('/');
    }
  };

  return (
    <div>
      <div className="flex items-center group px-1">
        {/* Expand/collapse chevron — separate from navigation */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-bg text-muted shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Icon — click to change */}
        <button
          onClick={changeIcon}
          className="px-1 py-1 rounded hover:bg-bg text-xs shrink-0"
          title="Change workspace icon"
        >
          {workspace.icon ?? '📁'}
        </button>

        {renaming ? (
          <>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') { setRenameValue(workspace.name); setRenaming(false); }
              }}
              autoFocus
              className="flex-1 min-w-0 bg-bg border border-border rounded px-1 py-0.5 text-xs uppercase tracking-wide text-text"
            />
            <button
              onClick={saveRename}
              className="p-1 rounded hover:bg-bg text-muted hover:text-green-600 shrink-0"
              aria-label="Save"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => { setRenameValue(workspace.name); setRenaming(false); }}
              className="p-1 rounded hover:bg-bg text-muted hover:text-red-500 shrink-0"
              aria-label="Cancel"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            {/* Workspace name — navigates to workspace page */}
            <Link
              href={`/workspace/${workspace.slug}`}
              onClick={onNavigate}
              className="flex-1 flex items-center gap-1 px-1 py-1 rounded hover:bg-bg text-xs uppercase tracking-wide text-muted truncate min-w-0"
            >
              <span className="truncate">{workspace.name}</span>
            </Link>
            <button
              onClick={() => createPage(null)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg shrink-0"
              aria-label="New page"
              title="New page"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={() => { setRenameValue(workspace.name); setRenaming(true); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg shrink-0 text-muted hover:text-text"
              aria-label="Rename workspace"
              title="Rename workspace"
            >
              <Edit3 size={11} />
            </button>
            <button
              onClick={deleteWorkspace}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg shrink-0 text-muted hover:text-red-500"
              aria-label="Delete workspace"
              title="Delete workspace"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="ml-2">
          {/* Databases */}
          {databases.map((db) => (
            <Link
              key={db.id}
              href={`/database/${db.id}`}
              onClick={onNavigate}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg text-sm text-text group/db"
            >
              <LayoutGrid size={12} className="text-muted shrink-0" />
              <span className="truncate flex-1">{db.name}</span>
            </Link>
          ))}

          {/* Pages */}
          {topLevel.length === 0 && databases.length === 0 ? (
            <button
              onClick={() => createPage(null)}
              className="text-xs text-muted px-2 py-1 hover:bg-bg rounded w-full text-left"
            >
              + New page
            </button>
          ) : (
            topLevel.map((p) => (
              <PageNode
                key={p.id}
                page={p}
                allPages={pages}
                level={0}
                onCreateChild={createPage}
                onNavigate={onNavigate}
                onChange={onChange}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PageNode({
  page,
  allPages,
  level,
  onCreateChild,
  onNavigate,
  onChange,
}: {
  page: Page;
  allPages: Page[];
  level: number;
  onCreateChild: (parentId: string) => void;
  onNavigate?: () => void;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const children = allPages
    .filter((p) => p.parentId === page.id)
    .sort((a, b) => a.position - b.position);
  const hasChildren = children.length > 0;

  const deletePage = async () => {
    if (!window.confirm(`Delete "${page.title || 'Untitled'}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/pages/${page.id}`, { method: 'DELETE' });
    if (res.ok) {
      onChange();
      // Navigate away if the deleted page is currently open
      if (pathname === `/page/${page.id}`) {
        router.push('/');
      }
    }
  };

  return (
    <div>
      <div
        className="group flex items-center px-1 rounded hover:bg-bg"
        style={{ paddingLeft: `${level * 12 + 4}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn('p-0.5', !hasChildren && 'invisible')}
          aria-label="Expand"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Link
          href={`/page/${page.id}`}
          onClick={onNavigate}
          className="flex-1 flex items-center gap-1.5 py-1 truncate text-sm"
        >
          <span>{page.icon ?? '📄'}</span>
          <span className="truncate">{page.title}</span>
        </Link>
        <button
          onClick={() => onCreateChild(page.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface"
          aria-label="Add child page"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={deletePage}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface text-muted hover:text-red-500"
          aria-label="Delete page"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {children.map((c) => (
            <PageNode
              key={c.id}
              page={c}
              allPages={allPages}
              level={level + 1}
              onCreateChild={onCreateChild}
              onNavigate={onNavigate}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
