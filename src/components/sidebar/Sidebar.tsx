'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Home, LogOut, Star } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { PageTree } from './PageTree';
import { cn } from '@/lib/utils';

type Workspace = { id: string; name: string; slug: string; icon: string | null };
type Page = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  workspaceId: string;
  isFavorite: boolean;
  position: number;
};

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pages, setPages] = useState<Page[]>([]);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setWorkspaces)
      .catch((err) => console.error('Failed to load workspaces:', err));
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setPages)
      .catch((err) => console.error('Failed to load pages:', err));
  }, []);

  const refresh = () => {
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setPages)
      .catch((err) => console.error('Failed to refresh pages:', err));
  };

  const favorites = pages.filter((p) => p.isFavorite);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 p-2 rounded-lg bg-surface border border-border"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/30"
        />
      )}

      <aside
        className={cn(
          'fixed md:relative z-40 inset-y-0 left-0 w-72 bg-surface border-r border-border flex flex-col transition-transform',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border">
          <span className="font-semibold text-sm">My Workspace</span>
          <button
            onClick={() => setOpen(false)}
            className="md:hidden p-1 rounded hover:bg-bg"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1 text-sm">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
          >
            <Home size={14} /> Home
          </Link>

          {favorites.length > 0 && (
            <div className="mt-4">
              <div className="px-2 py-1 text-xs uppercase tracking-wide text-muted flex items-center gap-1">
                <Star size={12} /> Favorites
              </div>
              {favorites.map((p) => (
                <Link
                  key={p.id}
                  href={`/page/${p.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg truncate"
                >
                  <span>{p.icon ?? '📄'}</span>
                  <span className="truncate">{p.title}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {workspaces.map((w) => (
              <PageTree
                key={w.id}
                workspace={w}
                pages={pages.filter((p) => p.workspaceId === w.id)}
                onChange={refresh}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </div>
        </nav>

        <div className="p-3 border-t border-border">
          <button
            onClick={() => signOut({ callbackUrl: '/signin' })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg text-sm text-muted"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
