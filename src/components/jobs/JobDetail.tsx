'use client';
import { useState } from 'react';
import { Sparkles, Loader2, ExternalLink, FileText, Trash2 } from 'lucide-react';
import { TailorFlow } from './TailorFlow';
import { InterviewPrep } from './InterviewPrep';
import { TrackerControls } from './TrackerControls';
import { postJson, errorText } from './api';
import type { Listing, Resume } from './types';

type Props = { listing: Listing; resumes: Resume[]; onChanged: () => void };

function useJobActions(listing: Listing, onChanged: () => void) {
  const [busy, setBusy] = useState<'' | 'analyze' | 'apply' | 'remove'>('');
  const [err, setErr] = useState('');
  const act = (kind: typeof busy, work: () => Promise<unknown>, fallback: string) => async () => {
    setErr(''); setBusy(kind);
    try { await work(); onChanged(); } catch (e) { setErr(errorText(e, fallback)); } finally { setBusy(''); }
  };
  const analyze = act('analyze', () => postJson(`/api/jobs/${listing.id}/analyze`), 'Analysis failed');
  const markApplied = act('apply', () => postJson(`/api/jobs/${listing.id}/apply`), 'Could not mark as applied');
  const remove = async () => {
    if (!confirm(`Remove “${listing.title}”? This also deletes its analysis, files and application history.`)) return;
    await act('remove', async () => {
      const r = await fetch(`/api/jobs/${listing.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Could not remove this job');
    }, 'Could not remove this job')();
  };
  return { busy, err, analyze, markApplied, remove };
}

export function JobDetail({ listing, resumes, onChanged }: Props) {
  const { busy, err, analyze, markApplied, remove } = useJobActions(listing, onChanged);
  const { analysis, application: app } = listing;

  return (
    <div className="px-4 pb-4 border-t border-border pt-3 space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <a href={listing.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={12} /> Listing</a>
        {listing.applyUrl && (
          <a href={listing.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={12} /> Apply page</a>
        )}
      </div>

      {analysis ? (
        <TailorFlow key={analysis.createdAt} listing={listing} analysis={analysis} resumes={resumes} onChanged={onChanged} reanalyze={analyze} analyzing={busy === 'analyze'} />
      ) : (
        <button onClick={analyze} disabled={!!busy || resumes.length === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50">
          {busy === 'analyze' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {resumes.length === 0 ? 'Upload a resume first' : 'Analyze fit'}
        </button>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {resumes.length > 0 && <InterviewPrep listing={listing} />}

      {app ? (
        <TrackerControls app={app} onChanged={onChanged} />
      ) : (
        <button onClick={markApplied} disabled={!!busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border text-sm hover:border-accent">
          <FileText size={14} /> Mark as applied
        </button>
      )}

      <div className="flex justify-end border-t border-border pt-3">
        <button onClick={remove} disabled={!!busy} className="inline-flex items-center gap-1.5 text-xs hover:text-red-600 disabled:opacity-50">
          {busy === 'remove' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove job
        </button>
      </div>
    </div>
  );
}
