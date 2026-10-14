'use client';
import { useState } from 'react';
import { Loader2, MessageSquareText, RefreshCw, Copy, Check } from 'lucide-react';
import { PrepQuestionItem } from './PrepQuestion';
import { postJson, errorText, useCopy } from './api';
import type { InterviewPrep as Prep, Listing } from './types';
import type { PrepKind } from '@/lib/jobs/prep';

const INTERVIEWING = new Set(['SCREEN', 'INTERVIEW', 'ONSITE']);

const GROUPS: { kinds: PrepKind[]; title: string }[] = [
  { kinds: ['behavioral', 'motivation'], title: 'Behavioral and motivation' },
  { kinds: ['technical', 'role'], title: 'Technical and role' },
];

function asText(prep: Prep): string {
  const qs = prep.questions.map((q) => `Q: ${q.q}\n${q.points.map((p) => `- ${p}`).join('\n')}\nStory: ${q.evidence}`);
  const gaps = prep.gaps.map((g) => `${g.gap}: ${g.answer}`);
  return [`Tell me about yourself\n${prep.pitch}`, ...qs, gaps.length ? `If they ask about gaps\n${gaps.join('\n')}` : '', `Ask them\n${prep.ask.map((a) => `- ${a}`).join('\n')}`]
    .filter(Boolean)
    .join('\n\n');
}

function Pack({ prep, listingId }: { prep: Prep; listingId: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Tell me about yourself</h4>
          <button onClick={() => copy(asText(prep))} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy whole pack'}
          </button>
        </div>
        <p className="text-sm whitespace-pre-wrap">{prep.pitch}</p>
      </section>
      {GROUPS.map((g) => {
        const qs = prep.questions.filter((q) => g.kinds.includes(q.kind));
        return qs.length ? (
          <section key={g.title} className="space-y-2">
            <h4 className="text-sm font-semibold">{g.title}</h4>
            {qs.map((q) => <PrepQuestionItem key={q.q} question={q} listingId={listingId} />)}
          </section>
        ) : null;
      })}
      {prep.gaps.length > 0 && (
        <section className="space-y-1 text-sm">
          <h4 className="font-semibold">If they probe a gap</h4>
          {prep.gaps.map((g) => <p key={g.gap}><strong>{g.gap}.</strong> {g.answer}</p>)}
        </section>
      )}
      {prep.ask.length > 0 && (
        <section className="space-y-1 text-sm">
          <h4 className="font-semibold">Questions to ask them</h4>
          <ul className="list-disc pl-5 space-y-0.5">{prep.ask.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

export function InterviewPrep({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const [prep, setPrep] = useState<Prep | null>(listing.prep);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const live = INTERVIEWING.has(listing.application?.status ?? '');

  const build = async () => {
    setErr(''); setBusy(true);
    try {
      setPrep((await postJson<{ prep: Prep }>(`/api/jobs/${listing.id}/prep`, {})).prep);
      onChanged();
    } catch (e) { setErr(errorText(e, 'Prep failed')); } finally { setBusy(false); }
  };

  return (
    <section className={`rounded border p-3 space-y-3 ${live ? 'border-accent' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex items-center gap-1.5"><MessageSquareText size={16} /> Interview prep</h3>
        <button onClick={build} disabled={busy} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm disabled:opacity-50 ${prep ? 'border border-border hover:border-accent' : 'bg-accent text-white'}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : prep ? <RefreshCw size={14} /> : <MessageSquareText size={14} />}
          {busy ? 'Preparing, about 20 seconds…' : prep ? 'Rebuild' : 'Prepare for this interview'}
        </button>
      </div>
      {!prep && !busy && <p className="text-sm">Likely questions for this role, talking points from your resume, honest answers for your gaps, and a place to practice each answer.</p>}
      {prep && (
        <p className="text-xs">
          <span className="text-muted">Built from {prep.resumeLabel} on {new Date(prep.createdAt).toLocaleDateString()}. </span>
          <span className="text-amber-800 dark:text-amber-300">The coach can link a skill to the wrong project; check each point against what you actually did.</span>
        </p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {prep && <Pack prep={prep} listingId={listing.id} />}
    </section>
  );
}
