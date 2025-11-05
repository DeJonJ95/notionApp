'use client';
import { useState, useEffect } from 'react';
import { Upload, X, AlertTriangle, FileText } from 'lucide-react';

interface Props {
  daysSinceLastImport: number | null;
  onImport: () => void;
}

const DISMISS_KEY = 'budget-import-reminder-dismissed';

export function ImportReminderBanner({ daysSinceLastImport, onImport }: Props) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored) {
        const dismissedAt = new Date(stored);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        if (dismissedAt > weekAgo) {
          setDismissed(true);
        } else {
          localStorage.removeItem(DISMISS_KEY);
        }
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable
    }
  };

  // No import yet — welcome prompt
  if (daysSinceLastImport === null) {
    if (dismissed) return null;
    return (
      <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 flex items-center gap-3">
        <FileText size={18} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">No bank statements imported yet</p>
          <p className="text-xs text-muted">Upload your first statement to start tracking income and expenses.</p>
        </div>
        <button
          onClick={onImport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 shrink-0"
        >
          <Upload size={12} /> Import now
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded hover:bg-bg text-muted hover:text-text shrink-0"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // Recent import — no reminder needed
  if (daysSinceLastImport <= 14) return null;

  // Overdue reminder
  if (dismissed) return null;

  const isUrgent = daysSinceLastImport > 30;
  const iconCls = isUrgent ? 'text-red-500' : 'text-yellow-500';
  const borderCls = isUrgent
    ? 'border-red-500/30 bg-red-500/5'
    : 'border-yellow-500/30 bg-yellow-500/5';

  return (
    <div className={`rounded-xl border ${borderCls} px-4 py-3 flex items-center gap-3`}>
      <AlertTriangle size={18} className={`${iconCls} shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {isUrgent
            ? `It's been ${daysSinceLastImport} days since your last import`
            : `It's been ${daysSinceLastImport} days since your last bank statement import`}
        </p>
        <p className="text-xs text-muted">
          {isUrgent
            ? 'Your budget data may be out of date. Import a recent statement to stay on top of your finances.'
            : 'Time to upload your latest statement and keep your budget up to date.'}
        </p>
      </div>
      <button
        onClick={onImport}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 shrink-0"
      >
        <Upload size={12} /> Import now
      </button>
      <button
        onClick={handleDismiss}
        className="p-1 rounded hover:bg-bg text-muted hover:text-text shrink-0"
        title="Dismiss for 7 days"
      >
        <X size={14} />
      </button>
    </div>
  );
}