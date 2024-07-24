'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Check, AlertCircle } from 'lucide-react';

type Props = {
  rawText: string;
  onClose: () => void;
  onAccept: (html: string) => void;
};

export function OrganizeModal({ rawText, onClose, onAccept }: Props) {
  const [mounted, setMounted] = useState(false);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    fetch('/api/organize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setHtml(data.html);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [rawText]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[6vh] bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-4xl mx-4 overflow-hidden flex flex-col max-h-[88vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 className="font-semibold text-sm">Organize with AI</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="flex items-center gap-3 text-muted text-sm">
              <Sparkles size={16} className="animate-pulse text-accent" />
              Organizing your notes…
            </div>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 max-w-sm">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          </div>
        )}

        {!loading && !error && (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
            {/* Before */}
            <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-border min-h-0 max-h-[40vh] md:max-h-none">
              <div className="px-4 py-2 border-b border-border bg-bg shrink-0">
                <span className="text-xs font-medium text-muted uppercase tracking-wide">Before</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-sm text-muted whitespace-pre-wrap font-sans leading-relaxed">
                  {rawText}
                </pre>
              </div>
            </div>

            {/* After */}
            <div className="flex-1 flex flex-col min-h-0 max-h-[40vh] md:max-h-none">
              <div className="px-4 py-2 border-b border-border bg-bg shrink-0 flex items-center gap-2">
                <span className="text-xs font-medium text-accent uppercase tracking-wide">After</span>
                <Sparkles size={11} className="text-accent" />
              </div>
              <div
                className="flex-1 overflow-y-auto p-4 prose prose-sm max-w-none [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-0.5"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onAccept(html); onClose(); }}
            disabled={loading || !!error || !html}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
          >
            <Check size={13} />
            Accept
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
