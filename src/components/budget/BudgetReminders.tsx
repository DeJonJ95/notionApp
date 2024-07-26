'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, ChevronUp, X, CheckCircle, RefreshCw, AlertTriangle, Clock, Calendar } from 'lucide-react';
import type { ReminderItem, RemindersPayload } from '@/app/api/budget/reminders/route';

function fmtAmount(n: number | null) {
  if (n == null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtDue(item: ReminderItem) {
  const d = item.daysUntilDue;
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d}d`;
}

function ReminderRow({
  item,
  onCleared,
}: {
  item: ReminderItem;
  onCleared: (pageId: string) => void;
}) {
  const [clearing, setClearing] = useState(false);

  const markCleared = async () => {
    if (!item.statusPropertyId) return;
    setClearing(true);
    await fetch('/api/property-values', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: item.pageId, propertyId: item.statusPropertyId, value: 'Cleared' }),
    });
    onCleared(item.pageId);
  };

  const urgency = item.daysUntilDue < 0 ? 'overdue' : item.daysUntilDue <= 3 ? 'urgent' : 'normal';

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div
        className={`w-1.5 h-8 rounded-full shrink-0 ${
          urgency === 'overdue' ? 'bg-red-500' : urgency === 'urgent' ? 'bg-yellow-500' : 'bg-blue-400'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link
            href={`/database/${item.databaseId}`}
            className="text-sm font-medium hover:text-accent truncate"
          >
            {item.title}
          </Link>
          {item.recurring && (
            <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-medium shrink-0">
              Recurring
            </span>
          )}
          {item.priority === 'Must Pay' && (
            <span className="text-[10px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-medium shrink-0">
              Must Pay
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span
            className={`text-xs font-medium ${
              urgency === 'overdue'
                ? 'text-red-500'
                : urgency === 'urgent'
                ? 'text-yellow-600'
                : 'text-blue-500'
            }`}
          >
            {fmtDue(item)}
          </span>
          {item.amount != null && (
            <span className="text-xs text-muted">{fmtAmount(item.amount)}</span>
          )}
          {item.vendor && <span className="text-xs text-muted truncate">{item.vendor}</span>}
          {item.category && (
            <span className="text-xs text-muted/70 bg-bg px-1.5 py-px rounded border border-border/50">
              {item.category}
            </span>
          )}
        </div>
      </div>
      {item.statusPropertyId && (
        <button
          onClick={markCleared}
          disabled={clearing}
          title="Mark as Cleared"
          className="p-1.5 rounded-lg hover:bg-green-500/10 text-muted hover:text-green-600 transition-colors shrink-0 disabled:opacity-50"
        >
          <CheckCircle size={15} />
        </button>
      )}
    </div>
  );
}

type SectionProps = {
  title: string;
  icon: React.ReactNode;
  items: ReminderItem[];
  defaultOpen?: boolean;
  onCleared: (pageId: string) => void;
  accentClass: string;
};

function Section({ title, icon, items, defaultOpen = true, onCleared, accentClass }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-2 text-xs font-semibold uppercase tracking-wide"
      >
        <span className={accentClass}>{icon}</span>
        <span className={accentClass}>{title}</span>
        <span className="ml-1 bg-bg border border-border rounded-full px-1.5 py-px text-muted font-normal">
          {items.length}
        </span>
        <span className="ml-auto text-muted">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>
      {open && (
        <div className="pl-1">
          {items.map((item) => (
            <ReminderRow key={item.pageId} item={item} onCleared={onCleared} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BudgetReminders() {
  const [data, setData] = useState<RemindersPayload | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/budget/reminders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCleared = (pageId: string) => {
    setDismissed((prev) => new Set([...prev, pageId]));
  };

  const filter = (items: ReminderItem[]) => items.filter((i) => !dismissed.has(i.pageId));

  if (loading) return null;
  if (!data) return null;

  const overdue = filter(data.overdue);
  const dueSoon = filter(data.dueSoon);
  const upcoming = filter(data.upcoming);
  const total = overdue.length + dueSoon.length + upcoming.length;

  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface mb-8">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Bell size={14} className={overdue.length > 0 ? 'text-red-500' : 'text-accent'} />
        <span className="font-semibold text-sm">Budget Reminders</span>
        {overdue.length > 0 && (
          <span className="text-xs bg-red-500 text-white rounded-full px-1.5 py-px font-medium">
            {overdue.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={load}
            className="p-1.5 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="p-1.5 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-1 divide-y divide-border/30">
          <Section
            title="Overdue"
            icon={<AlertTriangle size={12} />}
            items={overdue}
            accentClass="text-red-500"
            onCleared={handleCleared}
          />
          <Section
            title="Due This Week"
            icon={<Clock size={12} />}
            items={dueSoon}
            accentClass="text-yellow-600"
            onCleared={handleCleared}
          />
          <Section
            title="Upcoming — next 30 days"
            icon={<Calendar size={12} />}
            items={upcoming}
            defaultOpen={false}
            accentClass="text-blue-500"
            onCleared={handleCleared}
          />
        </div>
      )}
    </div>
  );
}
