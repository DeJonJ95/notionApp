'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, X, FileText, Wallet, BookOpen } from 'lucide-react';

const KEY = 'kove-welcome-dismissed-v1';

export function WelcomeCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { setShow(localStorage.getItem(KEY) !== '1'); } catch { setShow(true); }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY, '1'); } catch {}
    setShow(false);
  };

  return (
    <div className="relative mb-10 rounded-2xl border border-accent/30 bg-accent/5 p-5">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 p-1 rounded text-muted hover:text-text hover:bg-bg transition-colors"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-accent" />
        <h2 className="font-semibold text-text">Welcome to Kove</h2>
      </div>
      <p className="text-sm text-muted mb-4 max-w-xl">
        Your private workspace for notes, databases, and budgeting. Here&apos;s the fastest way
        to get value on day one:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <Link
          href="/budget"
          className="flex items-start gap-2.5 rounded-xl border border-border bg-bg p-3 hover:border-accent/50 transition-colors"
        >
          <Wallet size={16} className="text-accent shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium">Import a bank statement</div>
            <div className="text-xs text-muted">PDF or CSV — AI parses &amp; categorizes it.</div>
          </div>
        </Link>
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-bg p-3">
          <FileText size={16} className="text-accent shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium">Open a note</div>
            <div className="text-xs text-muted">Click any page in the sidebar — type &quot;/&quot; for blocks.</div>
          </div>
        </div>
        <Link
          href="/docs"
          className="flex items-start gap-2.5 rounded-xl border border-border bg-bg p-3 hover:border-accent/50 transition-colors"
        >
          <BookOpen size={16} className="text-accent shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium">Read the docs</div>
            <div className="text-xs text-muted">Every feature, explained in one page.</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
