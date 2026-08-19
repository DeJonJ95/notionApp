'use client';
import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface JournalCalendarProps {
  selectedDate: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  onClose?: () => void;
}

// Helpers — local-time zone, no UTC conversion.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=Sun .. 6=Sat
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function JournalCalendar({
  selectedDate,
  onSelect,
  onClose,
}: JournalCalendarProps) {
  const today = todayISO();
  const sel = selectedDate.split('-').map(Number);
  const [year, setYear] = useState(sel[0]);
  const [month, setMonth] = useState(sel[1] - 1); // 0-indexed
  const [entries, setEntries] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Fetch entries for the current month's range
  useEffect(() => {
    setLoading(true);
    const start = toISO(year, month, 1);
    const end = toISO(year, month, daysInMonth(year, month));
    fetch(`/api/journal/dates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.dates) {
          setEntries(new Set(data.dates.map((d: { date: string }) => d.date)));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [year, month]);

  const prevMonth = useCallback(() => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }, [month]);

  const dim = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);
  // Fill cells for the grid: empty cells before day 1, then 1..dim
  const cells: (number | null)[] = Array(startDay).fill(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  // Pad to fill last row (7 cols)
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg p-3 w-64">
      {/* Month / Year header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-1 rounded hover:bg-bg text-muted"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-medium">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          className="p-1 rounded hover:bg-bg text-muted"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((h) => (
          <div
            key={h}
            className="text-center text-[10px] uppercase text-muted font-medium py-1"
          >
            {h}
          </div>
        ))}
      </div>

      {/* Day cells */}
      {loading ? (
        <div className="text-center text-xs text-muted py-4">Loading…</div>
      ) : (
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />;

            const dateStr = toISO(year, month, day);
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasEntry = entries.has(dateStr);
            const isFuture = dateStr > today;

            return (
              <button
                key={dateStr}
                onClick={() => {
                  if (!isFuture) onSelect(dateStr);
                }}
                disabled={isFuture}
                className={cn(
                  'relative text-xs w-8 h-8 rounded flex items-center justify-center transition-colors',
                  isSelected
                    ? 'bg-accent text-white font-semibold'
                    : isToday
                      ? 'ring-1 ring-inset ring-accent text-text font-medium'
                      : isFuture
                        ? 'text-muted/30 cursor-default'
                        : 'text-text hover:bg-bg',
                )}
              >
                {day}
                {/* Entry dot */}
                {hasEntry && !isSelected && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent/60" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Today shortcut */}
      {selectedDate !== today && (
        <button
          onClick={() => onSelect(today)}
          className="mt-2 w-full text-xs text-accent hover:underline py-1"
        >
          Jump to today
        </button>
      )}
    </div>
  );
}