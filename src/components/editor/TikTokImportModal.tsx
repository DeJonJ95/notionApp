'use client';
import { useState } from 'react';
import { Loader2, X, Music2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onImport: (data: { title: string; text: string }) => void;
}

export function TikTokImportModal({ onClose, onImport }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tiktok-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to fetch transcript');
      onImport({ title: json.title, text: json.text });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="font-semibold text-text flex items-center gap-2">
            <Music2 size={16} className="text-pink-500" />
            Import TikTok transcript
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="text-sm text-muted">TikTok URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.tiktok.com/@user/video/…"
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent text-text"
            disabled={loading}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            autoFocus
          />
          <p className="text-xs text-muted/80 leading-relaxed">
            Pulls TikTok&apos;s auto-captions via Supadata. Works only on videos that
            actually have a caption track — many TikToks don&apos;t, so this fails more
            often than the YouTube import. Short / shared links (vm.tiktok.com) are fine.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={submit}
            disabled={loading || !url.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium hover:bg-pink-500/90 disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />}
            {loading ? 'Fetching…' : 'Import transcript'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
