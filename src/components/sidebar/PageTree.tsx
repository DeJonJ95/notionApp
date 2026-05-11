'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Workspace = { id: string; name: string; slug: string; icon: string | null };
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
  onChange,
  onNavigate,
}: {
  workspace: Workspace;
  pages: Page[];
  onChange: () => void;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
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
      window.location.href = `/page/${page.id}`;
    }
  };

  return (
    <div>
      <div className="flex items-center group px-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 flex-1 px-1 py-1 rounded hover:bg-bg text-xs uppercase tracking-wide text-muted"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{workspace.icon}</span>
          <span className="truncate">{workspace.name}</span>
        </button>
        <button
          onClick={() => createPage(null)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg"
          aria-label="New page"
        >
          <Plus size={12} />
        </button>
      </div>

      {expanded && (
        <div className="ml-2">
          {topLevel.length === 0 ? (
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
}: {
  page: Page;
  allPages: Page[];
  level: number;
  onCreateChild: (parentId: string) => void;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = allPages
    .filter((p) => p.parentId === page.id)
    .sort((a, b) => a.position - b.position);
  const hasChildren = children.length > 0;

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
          aria-label="Add child"
        >
          <Plus size={12} />
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
