'use client';
import { useEffect, useState } from 'react';
import { Loader2, X, ClipboardList } from 'lucide-react';

interface Props {
  rawText: string;
  onClose: () => void;
  onInsert: (html: string) => void;
}

export function SummarizeModal({ rawText, onClose, onInsert }: Props) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawText }),
        });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok) setError(json.error ?? 'Summarize failed');
          else setHtml(json.html ?? '');
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rawText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <ClipboardList size={16} className="text-accent" />
            Summary
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center h-32 gap-3">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-sm text-muted">Summarizing with DeepSeek…</span>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && (
            <div
              className="prose-base text-text"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>

        {/* Footer */}
        {!loading && !error && html && (
          <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0">
            <button
              onClick={() => { onInsert(html); onClose(); }}
              className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
            >
              Insert at top of page
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
