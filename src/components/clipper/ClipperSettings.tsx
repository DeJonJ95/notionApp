'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, Trash2, KeyRound, ExternalLink, AlertCircle, Plus } from 'lucide-react';

type Token = {
  id: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never used';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ClipperSettings() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  // The freshly-minted token gets stashed here for the one-time reveal.
  // Once the user clicks "I copied it" we drop it and the user can never
  // see it again — same pattern as GitHub PAT or AWS access keys.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/clipper/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load tokens');
      setTokens(data.tokens);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/clipper/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create token');
      setRevealed(data.token);
      setLabel('');
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select-and-copy via execCommand
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this token? Any extension using it will stop working.')) return;
    const res = await fetch(`/api/clipper/tokens/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
  };

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Browser clipper</h1>
        <p className="text-sm text-muted mt-1">
          Save images from Pinterest, Tumblr, or anywhere else into your notes with one click.
        </p>
      </div>

      {/* Reveal panel — only shown immediately after generating a new token */}
      {revealed && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            <KeyRound size={14} />
            New token — copy it now
          </div>
          <p className="text-xs text-muted">
            This is the only time you&apos;ll see the full token. Copy it now and paste it into the extension.
            We can&apos;t show it again because we only keep a hash.
          </p>
          <div className="flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-2 font-mono text-xs break-all">
            <span className="flex-1">{revealed}</span>
            <button
              onClick={() => copyToClipboard(revealed)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-accent text-white text-xs hover:opacity-90"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => { setRevealed(null); setCopied(false); }}
            className="text-xs text-muted hover:text-text"
          >
            I copied it — hide
          </button>
        </div>
      )}

      {/* Generate */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-semibold">Create a new token</h2>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='Label (optional) — e.g. "Laptop Chrome"'
            className="flex-1 px-3 py-1.5 rounded border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            maxLength={60}
          />
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={13} />
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <p className="text-xs text-muted">
          Create a separate token per browser/device so you can revoke individually.
        </p>
      </div>

      {/* Existing tokens */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Active tokens</h2>
        </div>
        {error && (
          <div className="m-4 flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="mt-0.5" />
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted p-5 text-center">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted p-5 text-center">No tokens yet. Generate one above to get started.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                <KeyRound size={14} className="text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{t.label || 'Unnamed'}</span>
                    <span className="text-muted font-mono text-xs">{t.prefix}…</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Created {timeAgo(t.createdAt)} · Last used {timeAgo(t.lastUsedAt)}
                  </p>
                </div>
                <button
                  onClick={() => revoke(t.id)}
                  className="shrink-0 p-1.5 rounded text-muted hover:text-red-500 hover:bg-bg"
                  title="Revoke"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Install instructions — desktop extension */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ExternalLink size={14} /> Desktop — Chrome extension
        </h2>
        <ol className="text-sm text-muted space-y-2 list-decimal list-inside leading-relaxed">
          <li>
            Download the latest extension zip from the repo&apos;s <code className="text-xs bg-bg px-1 py-0.5 rounded">extension/</code> folder.
          </li>
          <li>Extract it somewhere stable on your computer (not in Downloads — Chrome will lose track if you move it).</li>
          <li>
            Open <code className="text-xs bg-bg px-1 py-0.5 rounded">chrome://extensions/</code>, enable
            <strong className="text-text"> Developer mode</strong> (top-right toggle).
          </li>
          <li>Click <strong className="text-text">Load unpacked</strong> and select the extracted folder.</li>
          <li>Click the extension icon in your toolbar, paste your token, and hit <strong className="text-text">Connect</strong>.</li>
        </ol>
        <p className="text-xs text-muted pt-2 border-t border-border">
          Then on any page, hover any image to see a <strong className="text-text">Save to notes</strong> button — or right-click → Save to notes.
        </p>
      </div>

      {/* Install instructions — mobile PWA */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ExternalLink size={14} /> Mobile — install Kove as an app
        </h2>
        <p className="text-xs text-muted">
          Mobile browsers don&apos;t support extensions. Instead, install Kove to your
          home screen — Kove then shows up in any app&apos;s <strong className="text-text">Share</strong>
          sheet (Pinterest, Tumblr, Safari, Instagram, etc.). Tap Share → pick Kove → choose a note.
          No token needed; uses your normal browser sign-in.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 pt-1">
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="text-xs font-semibold text-text">iPhone / iPad (Safari)</p>
            <ol className="text-xs text-muted list-decimal list-inside leading-relaxed space-y-0.5">
              <li>Open Kove in Safari (not Chrome on iOS — share-target needs Safari).</li>
              <li>Tap the <strong className="text-text">Share</strong> button (square + arrow).</li>
              <li>Pick <strong className="text-text">Add to Home Screen</strong>.</li>
              <li>Tap <strong className="text-text">Add</strong>.</li>
            </ol>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="text-xs font-semibold text-text">Android (Chrome)</p>
            <ol className="text-xs text-muted list-decimal list-inside leading-relaxed space-y-0.5">
              <li>Open Kove in Chrome.</li>
              <li>Tap the <strong className="text-text">⋮</strong> menu (top-right).</li>
              <li>Pick <strong className="text-text">Install app</strong> or <strong className="text-text">Add to Home screen</strong>.</li>
              <li>Confirm <strong className="text-text">Install</strong>.</li>
            </ol>
          </div>
        </div>
        <p className="text-xs text-muted pt-2 border-t border-border">
          Once installed, open Pinterest (or any app), tap Share on a pin, and pick <strong className="text-text">Kove</strong>
          from the share sheet. The picker opens with the image preview and your recent notes.
        </p>
      </div>
    </div>
  );
}
