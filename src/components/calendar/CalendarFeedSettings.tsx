'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, CalendarDays, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';

type FeedInfo = {
  hasFeed: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
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

export function CalendarFeedSettings() {
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Full subscribe URL — only available right after (re)generating.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/calendar/feed');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load feed');
      setInfo(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/calendar/feed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create feed');
      setRevealed(data.url);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm('Revoke the calendar feed? Any calendar subscribed to it will stop updating.')) return;
    setBusy(true);
    try {
      await fetch('/api/calendar/feed', { method: 'DELETE' });
      setRevealed(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays size={22} /> Calendar feed
        </h1>
        <p className="text-sm text-muted mt-1">
          Subscribe to your dated database items in Google Calendar or Outlook. Every
          item with a <strong className="text-text">Date</strong> property shows up as an
          all-day event. The feed is read-only — edits in your calendar don&apos;t sync back.
        </p>
      </div>

      {/* One-time reveal of the full subscribe URL */}
      {revealed && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            <CalendarDays size={14} />
            Your feed URL — copy it now
          </div>
          <p className="text-xs text-muted">
            This is the only time the full URL is shown. It contains a secret token, so treat
            it like a password. Paste it into your calendar app (steps below).
          </p>
          <div className="flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-2 font-mono text-xs break-all">
            <span className="flex-1">{revealed}</span>
            <button
              onClick={() => copy(revealed)}
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

      {/* Feed status / actions */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="mt-0.5" />
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted text-center py-2">Loading…</p>
        ) : info?.hasFeed ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">Feed active</span>{' '}
              <span className="text-muted font-mono text-xs">{info.prefix}…</span>
              <p className="text-xs text-muted mt-0.5">
                Created {timeAgo(info.createdAt)} · Last fetched by a calendar {timeAgo(info.lastUsedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={generate}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-bg text-sm hover:bg-surface disabled:opacity-50"
              >
                <RefreshCw size={13} /> Regenerate URL
              </button>
              <button
                onClick={revoke}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 size={13} /> Revoke
              </button>
            </div>
            <p className="text-xs text-muted">
              The full URL is only shown once. If you lost it, regenerate — but you&apos;ll have
              to re-subscribe in your calendar with the new URL.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">No feed yet. Generate a subscribe URL to get started.</p>
            <button
              onClick={generate}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <CalendarDays size={13} /> {busy ? 'Generating…' : 'Generate feed URL'}
            </button>
          </div>
        )}
      </div>

      {/* Subscribe instructions */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-5 space-y-2">
          <h2 className="text-sm font-semibold">Google Calendar</h2>
          <ol className="text-xs text-muted list-decimal list-inside leading-relaxed space-y-1">
            <li>Open Google Calendar on the web.</li>
            <li>Next to <strong className="text-text">Other calendars</strong> (left), click <strong className="text-text">+</strong>.</li>
            <li>Pick <strong className="text-text">From URL</strong>.</li>
            <li>Paste your feed URL and click <strong className="text-text">Add calendar</strong>.</li>
          </ol>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 space-y-2">
          <h2 className="text-sm font-semibold">Outlook</h2>
          <ol className="text-xs text-muted list-decimal list-inside leading-relaxed space-y-1">
            <li>Open Outlook Calendar (web or desktop).</li>
            <li>Click <strong className="text-text">Add calendar</strong> → <strong className="text-text">Subscribe from web</strong>.</li>
            <li>Paste your feed URL, give it a name, and click <strong className="text-text">Import</strong>.</li>
          </ol>
        </div>
      </div>

      <p className="text-xs text-muted">
        Note: Google and Outlook refresh subscribed URLs on their own schedule — often only
        every several hours, sometimes up to a day. New or changed items won&apos;t appear instantly.
      </p>
    </div>
  );
}
