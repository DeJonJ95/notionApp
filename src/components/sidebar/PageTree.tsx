'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronRight, ChevronDown, Plus, Trash2, LayoutGrid } from 'lucide-react';
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
  const router = useRouter();
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
        {/* Workspace name — navigates to workspace page */}
        <Link
          href={`/workspace/${workspace.slug}`}
          onClick={onNavigate}
          className="flex-1 flex items-center gap-1 px-1 py-1 rounded hover:bg-bg text-xs uppercase tracking-wide text-muted truncate min-w-0"
        >
          {workspace.icon && <span>{workspace.icon}</span>}
          <span className="truncate">{workspace.name}</span>
        </Link>
        <button
          onClick={() => createPage(null)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg shrink-0"
          aria-label="New page"
        >
          <Plus size={12} />
        </button>
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
