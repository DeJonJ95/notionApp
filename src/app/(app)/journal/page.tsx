'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { JournalCalendar } from '@/components/journal/JournalCalendar';
import { CanvasPageEditor } from '@/components/editor/CanvasPageEditor';
import type { CanvasBlockData } from '@/components/editor/CanvasPageEditor';

// ── Date helpers (local time only) ──────────────────────────────────────
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function JournalPage() {
  const today = isoToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageData, setPageData] = useState<any>(null);
  const [blocks, setBlocks] = useState<CanvasBlockData[]>([]);
  const [loading, setLoading] = useState(true);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar on outside click
  useEffect(() => {
    if (!showCalendar) return;
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendar]);

  // Load the journal entry for a given date
  const loadEntry = useCallback(async (date: string) => {
    setLoading(true);
    setPageId(null);
    setPageData(null);
    setBlocks([]);

    try {
      // Get or create the journal page for this date
      const res = await fetch(`/api/journal/today?date=${date}`);
      if (!res.ok) { setLoading(false); return; }
      const { pageId: pid } = await res.json();
      if (!pid) { setLoading(false); return; }

      // Load the page blocks
      const pageRes = await fetch(`/api/pages/${pid}`);
      if (!pageRes.ok) { setLoading(false); return; }
      const page = await pageRes.json();

      setPageId(pid);
      setPageData({
        id: pid,
        title: page.title,
        icon: page.icon ?? null,
        cover: page.cover ?? null,
        isFavorite: page.isFavorite ?? false,
      });

      const initialBlocks: CanvasBlockData[] = (page.blocks ?? []).map((b: any) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        canvasX: b.canvasX ?? 60,
        canvasY: b.canvasY ?? 60,
        canvasWidth: b.canvasWidth ?? 420,
        position: b.position,
      }));
      setBlocks(initialBlocks);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load today's entry on mount
  useEffect(() => {
    loadEntry(selectedDate);
  }, [selectedDate, loadEntry]);

  const canGoBack = true; // always allow going back
  const canGoForward = selectedDate < today;

  const goBack = () => {
    if (!canGoBack) return;
    setSelectedDate((d) => addDays(d, -1));
    setShowCalendar(false);
  };

  const goForward = () => {
    if (!canGoForward) return;
    setSelectedDate((d) => addDays(d, 1));
    setShowCalendar(false);
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setShowCalendar(false);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sticky header with date navigation */}
      <div className="sticky top-0 z-10 bg-surface border-b border-border">
        <div className="flex items-center justify-between px-4 py-2 max-w-4xl mx-auto w-full">
          <div className="flex items-center gap-2">
            {/* Previous day */}
            <button
              onClick={goBack}
              className="p-1.5 rounded hover:bg-bg text-muted transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft size={16} />
            </button>

            {/* Date label */}
            <h1 className="text-base font-semibold min-w-[180px] text-center select-none">
              {formatDisplay(selectedDate)}
            </h1>

            {/* Next day — only enabled for past dates */}
            <button
              onClick={goForward}
              disabled={!canGoForward}
              className="p-1.5 rounded hover:bg-bg text-muted transition-colors disabled:opacity-20 disabled:cursor-default"
              aria-label="Next day"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Today button — only shown when not on today */}
            {selectedDate !== today && (
              <button
                onClick={() => handleDateSelect(today)}
                className="text-xs text-accent hover:underline px-2 py-1 rounded hover:bg-bg transition-colors"
              >
                Today
              </button>
            )}

            {/* Calendar toggle */}
            <div className="relative" ref={calendarRef}>
              <button
                onClick={() => setShowCalendar((v) => !v)}
                className="p-1.5 rounded hover:bg-bg text-muted transition-colors"
                aria-label="Open calendar"
                title="Calendar"
              >
                <CalendarIcon size={16} />
              </button>
              {showCalendar && (
                <div className="absolute right-0 top-full mt-1 z-50">
                  <JournalCalendar
                    selectedDate={selectedDate}
                    onSelect={handleDateSelect}
                    onClose={() => setShowCalendar(false)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-muted">Loading journal…</div>
          </div>
        ) : pageData && blocks.length > 0 ? (
          <CanvasPageEditor
            page={pageData}
            initialBlocks={blocks}
            initialViewMode="document"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-muted">
              No journal entry for this date.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}