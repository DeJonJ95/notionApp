'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Home, LogOut, Star, Search, LayoutTemplate, Sparkles } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { PageTree } from './PageTree';
import { SearchModal } from '@/components/search/SearchModal';
import { TemplateModal } from '@/components/templates/TemplateModal';
import { ExtractFromNotes } from '@/components/extract/ExtractFromNotes';
import { cn } from '@/lib/utils';

type Database = { id: string; name: string };
type Workspace = { id: string; name: string; slug: string; icon: string | null; databases: Database[] };
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [todayJournalId, setTodayJournalId] = useState<string | null>(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setWorkspaces)
      .catch((err) => console.error('Failed to load workspaces:', err));
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setPages)
      .catch((err) => console.error('Failed to load pages:', err));

    // Auto-create today's journal page (idempotent — safe to call every mount).
    // Pass the client's local date so the title matches the user's timezone.
    const d = new Date();
    const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fetch(`/api/journal/today?date=${localDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.pageId) return;
        setTodayJournalId(data.pageId);
        if (data.created) {
          // Refresh page tree so the new journal page appears in the sidebar.
          fetch('/api/pages')
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then(setPages)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const refresh = () => {
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setPages)
      .catch((err) => console.error('Failed to refresh pages:', err));
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setWorkspaces)
      .catch((err) => console.error('Failed to refresh workspaces:', err));
  };

  const favorites = pages.filter((p) => p.isFavorite);

  return (
    <>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {templateOpen && (
        <TemplateModal
          onClose={() => setTemplateOpen(false)}
          onCreated={refresh}
        />
      )}
      {extractOpen && <ExtractFromNotes onClose={() => setExtractOpen(false)} />}

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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded hover:bg-bg text-muted hover:text-text transition-colors"
              aria-label="Search (⌘K)"
              title="Search (⌘K)"
            >
              <Search size={15} />
            </button>
            <button
              onClick={() => { setExtractOpen(true); setOpen(false); }}
              className="p-1.5 rounded hover:bg-bg text-muted hover:text-text transition-colors"
              aria-label="Extract from notes"
              title="Extract from notes"
            >
              <Sparkles size={15} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="md:hidden p-1 rounded hover:bg-bg"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search trigger row — visible inside the sidebar nav */}
        <button
          onClick={() => setSearchOpen(true)}
          className="mx-2 mt-2 flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted hover:bg-bg w-[calc(100%-1rem)] transition-colors"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-xs font-mono bg-bg border border-border rounded px-1 py-0.5 hidden md:inline">⌘K</kbd>
        </button>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1 text-sm">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
          >
            <Home size={14} /> Home
          </Link>

          <button
            onClick={() => { setTemplateOpen(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg text-left"
          >
            <LayoutTemplate size={14} /> Templates
          </button>

          <button
            onClick={() => { setExtractOpen(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg text-left"
          >
            <Sparkles size={14} /> Extract from notes
          </button>

          {todayJournalId && (
            <Link
              href={`/page/${todayJournalId}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg font-medium text-accent"
            >
              <span>📔</span> Today&apos;s Journal
            </Link>
          )}

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
                databases={w.databases}
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
