'use client';
import { useState } from 'react';
import { Moon, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/feedback';

// Generates an AI evening review (reflection + tomorrow's priorities) from the
// day's journal, budget, and job-hunt activity, then appends it to the entry.
export function EveningReviewButton({
  pageId,
  date,
  onDone,
}: {
  pageId: string;
  date: string;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/journal/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, date }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('Evening review added');
        onDone();
      } else if (res.status === 429) {
        toast.error(json.error ?? 'Daily AI budget reached');
      } else {
        toast.error(json.error ?? 'Could not generate review');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs text-accent hover:underline px-2 py-1 rounded hover:bg-bg transition-colors disabled:opacity-60"
      title="Summarize today and set tomorrow's priorities"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Moon size={13} />}
      Evening review
    </button>
  );
}
