'use client';
import { useEffect, useState } from 'react';
import { Loader2, X, Mail, Copy, ExternalLink, Check } from 'lucide-react';

interface Props {
  vendor: string;
  monthlyAmount: number;
  lastChargeDate: string;
  onClose: () => void;
}

export function CancelEmailModal({ vendor, monthlyAmount, lastChargeDate, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/budget/cancel-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor, monthlyAmount, lastChargeDate }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? 'Failed to generate email');
        } else {
          setTo(json.to ?? '');
          setSubject(json.subject ?? '');
          setBody(json.body ?? '');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vendor, monthlyAmount, lastChargeDate]);

  const copyAll = async () => {
    const composed = `To: ${to}\nSubject: ${subject}\n\n${body}`;
    await navigator.clipboard.writeText(composed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openInMail = () => {
    // mailto: handles encoding for most clients; long bodies trigger Gmail compose if used.
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  };

  const openInGmail = () => {
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Mail size={16} className="text-accent" />
            Cancel {vendor}
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {loading && (
            <div className="flex flex-col items-center justify-center h-32 gap-3">
              <Loader2 size={20} className="animate-spin text-accent" />
              <span className="text-sm text-muted">DeepSeek is drafting your cancellation email…</span>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted">
                To
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent text-text"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Subject
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent text-text"
                />
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent text-text resize-none font-mono leading-relaxed"
              />
              <p className="text-xs text-muted/80">
                Best-guess support address — verify on the company&apos;s site before sending.
              </p>
            </>
          )}
        </div>

        {!loading && !error && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-border shrink-0">
            <button
              onClick={copyAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
            >
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={openInGmail}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface"
            >
              <ExternalLink size={14} /> Open in Gmail
            </button>
            <button
              onClick={openInMail}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent/80 ml-auto"
            >
              <Mail size={14} /> Send via mail app
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
