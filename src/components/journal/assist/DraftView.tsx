'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, Mail, CornerDownRight, AlertTriangle } from 'lucide-react';
import { fillIns } from '@/lib/assist/blanks';
import type { DraftResult } from '@/lib/assist/types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mailto(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
  return `mailto:${EMAIL.test(to) ? encodeURIComponent(to) : ''}?${q}`;
}

type Props = { draft: DraftResult; onInsert: (text: string) => void };

export function DraftView({ draft, onInsert }: Props) {
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setTo(draft.to); setSubject(draft.subject); setBody(draft.body); }, [draft]);

  const blanks = fillIns(to, subject, body);
  const isEmail = draft.kind === 'email';
  const full = isEmail && subject ? `Subject: ${subject}\n\n${body}` : body;

  const copy = () => {
    navigator.clipboard.writeText(full).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };

  return (
    <div className="space-y-3">
      {isEmail && (
        <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-sm">
          <label htmlFor="assist-to">To</label>
          <input id="assist-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" className="px-2 py-1.5 rounded border border-border bg-bg" />
          <label htmlFor="assist-subject">Subject</label>
          <input id="assist-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="px-2 py-1.5 rounded border border-border bg-bg" />
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(18, Math.max(8, body.split('\n').length + 2))}
        className="w-full px-3 py-2 rounded border border-border bg-bg text-sm leading-relaxed"
        aria-label="Draft"
      />
      {blanks.length > 0 && (
        <p className="text-sm flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Fill in before sending: {blanks.join(', ')}.</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {isEmail && (
          <a href={mailto(to, subject, body)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm">
            <Mail size={14} /> Open in mail app
          </a>
        )}
        <button onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-sm hover:border-accent">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => onInsert(full)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-sm hover:border-accent">
          <CornerDownRight size={14} /> Add under the to-do
        </button>
      </div>
    </div>
  );
}
