'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Home, LogOut, Star, Search, LayoutTemplate, Sparkles, BarChart2, Bell, Wallet, Plus, BookOpen } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { PageTree } from './PageTree';
import { SearchModal } from '@/components/search/SearchModal';
import { TemplateModal } from '@/components/templates/TemplateModal';
import { ExtractFromNotes } from '@/components/extract/ExtractFromNotes';
import { cn } from '@/lib/utils';
import { promptDialog } from '@/components/ui/feedback';

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

const ADMIN_EMAIL = 'dejonj95@gmail.com';

export function Sidebar() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.email === ADMIN_EMAIL;
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [reminderCount, setReminderCount] = useState(0);
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
    fetch('/api/budget/reminders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setReminderCount(d.overdue + d.dueSoon ? d.overdue.length + d.dueSoon.length : 0); })
      .catch(() => {});

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

  // Let any component (e.g. deleting a page from inside the note editor)
  // ask the sidebar tree to refetch without prop drilling.
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener('kove:refresh-tree', onRefresh);
    return () => window.removeEventListener('kove:refresh-tree', onRefresh);
  }, []);

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

      {/* Mobile toggle — floating bottom-left so it never sits on top of
          page titles / breadcrumbs (which are top-left). Hidden while the
          drawer is open. Bottom-right is reserved for canvas zoom controls. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="md:hidden fixed bottom-4 left-4 z-40 p-3 rounded-full bg-surface border border-border shadow-lg active:scale-95 transition-transform"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
      )}

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
          <span className="font-semibold text-sm">Kove</span>
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

          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
          >
            <Bell size={14} />
            <span className="flex-1">Reminders</span>
            {reminderCount > 0 && (
              <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-px font-semibold leading-none">
                {reminderCount}
              </span>
            )}
          </Link>

          <Link
            href="/budget"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
          >
            <Wallet size={14} /> Budget
          </Link>

          <Link
            href="/docs"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
          >
            <BookOpen size={14} /> Docs
          </Link>

          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg"
            >
              <BarChart2 size={14} /> Usage
            </Link>
          )}

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
            <button
              onClick={async () => {
                const name = await promptDialog({
                  title: 'New workspace',
                  message: 'Name your workspace.',
                  defaultValue: 'New workspace',
                });
                if (name === null) return;
                const trimmed = name.trim() || 'New workspace';
                await fetch('/api/workspaces', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: trimmed }),
                });
                refresh();
              }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted hover:bg-bg hover:text-text transition-colors"
              title="Create a new workspace"
            >
              <Plus size={12} /> New workspace
            </button>
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
