'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotebookPen } from 'lucide-react';

// Home-screen shortcut to today's journal. Mirrors the sidebar's auto-create
// fetch (idempotent), but surfaces it as a prominent button so mobile users
// don't have to open the drawer and desktop users don't have to scan the
// sidebar. Prefetches the page id on mount for instant navigation; if the
// click lands before the fetch resolves, it fetches on demand.
export function TodaysNoteButton() {
  const router = useRouter();
  const [pageId, setPageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Client local date so the journal title matches the user's timezone.
  const localDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  useEffect(() => {
    fetch(`/api/journal/today?date=${localDate()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.pageId) setPageId(data.pageId); })
      .catch(() => {});
  }, []);

  const go = async () => {
    if (pageId) { router.push(`/page/${pageId}`); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/journal/today?date=${localDate()}`);
      const data = r.ok ? await r.json() : null;
      if (data?.pageId) router.push(`/page/${data.pageId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={go}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white font-medium shadow-sm hover:opacity-90 active:scale-[0.98] transition disabled:opacity-60"
    >
      <NotebookPen size={18} />
      {loading ? 'Opening…' : "Open today's note"}
    </button>
  );
}
