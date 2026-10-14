'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react';
import { postJson, errorText } from './api';
import type { PracticeFeedback, PrepQuestion } from '@/lib/jobs/prep';

const RATING_TONE: Record<PracticeFeedback['rating'], string> = {
  strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  solid: 'bg-accent/10 text-accent',
  'needs work': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

function Feedback({ fb }: { fb: PracticeFeedback }) {
  return (
    <div className="text-sm space-y-2 border-t border-border pt-2">
      <span className={`text-xs px-2 py-0.5 rounded-full ${RATING_TONE[fb.rating]}`}>{fb.rating}</span>
      {fb.strengths.length > 0 && (
        <div><strong>Working:</strong><ul className="list-disc pl-5">{fb.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>
      )}
      {fb.improve.length > 0 && (
        <div><strong>Sharpen:</strong><ul className="list-disc pl-5">{fb.improve.map((s) => <li key={s}>{s}</li>)}</ul></div>
      )}
      {fb.tighter && (
        <div>
          <strong>Tighter version:</strong>
          <p className="whitespace-pre-wrap mt-0.5">{fb.tighter}</p>
          <p className="text-xs mt-1 text-amber-800 dark:text-amber-300">The coach can smooth over gaps. Say only the sentences that are true for you.</p>
        </div>
      )}
    </div>
  );
}

function Practice({ question, listingId }: { question: PrepQuestion; listingId: string }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fb, setFb] = useState<PracticeFeedback | null>(null);

  const send = async () => {
    setErr(''); setBusy(true);
    try {
      const d = await postJson<{ feedback: PracticeFeedback }>(`/api/jobs/${listingId}/prep/practice`, { q: question.q, why: question.why, answer });
      setFb(d.feedback);
    } catch (e) { setErr(errorText(e, 'Could not get feedback')); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} placeholder="Type your answer the way you would say it out loud…" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-sm" />
      <button onClick={send} disabled={busy || answer.trim().length < 20} className="inline-flex items-center gap-1.5 px-3 py-1 rounded border border-border text-sm hover:border-accent disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Get feedback
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {fb && <Feedback fb={fb} />}
    </div>
  );
}

export function PrepQuestionItem({ question, listingId }: { question: PrepQuestion; listingId: string }) {
  const [open, setOpen] = useState(false);
  const [practicing, setPracticing] = useState(false);
  return (
    <div className="border border-border rounded bg-bg">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown size={15} className="mt-0.5 shrink-0" /> : <ChevronRight size={15} className="mt-0.5 shrink-0" />}
        <span className="font-medium">{question.q}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-8 space-y-2 text-sm">
          {question.why && <p><strong>What they want to know:</strong> {question.why}</p>}
          {question.points.length > 0 && <ul className="list-disc pl-5 space-y-0.5">{question.points.map((p) => <li key={p}>{p}</li>)}</ul>}
          {question.evidence && <p><strong>Your story:</strong> {question.evidence}</p>}
          {practicing ? (
            <Practice question={question} listingId={listingId} />
          ) : (
            <button onClick={() => setPracticing(true)} className="text-sm text-accent hover:underline">Practice this answer</button>
          )}
        </div>
      )}
    </div>
  );
}
