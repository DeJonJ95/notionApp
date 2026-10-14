'use client';
import { useMemo, useState } from 'react';
import { Loader2, Wand2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { FitSummary } from './FitSummary';
import { TweakList, defaultApproved } from './TweakList';
import { AtsReportView } from './AtsReportView';
import { RecruiterMessage, CoverLetterSection } from './Outreach';
import { postJson, errorText, fileUrl } from './api';
import type { Analysis, AtsReport, Listing, Resume, Tweak } from './types';

type Props = { listing: Listing; analysis: Analysis; resumes: Resume[]; onChanged: () => void; reanalyze: () => void; analyzing: boolean };

type TailorResponse = {
  applied: number;
  unmatched: Tweak[];
  recruiterMessage: string | null;
  report: AtsReport;
  tailoredFile: boolean;
  downloadUrl: string | null;
  atsUrl: string | null;
};

function Outcome({ result }: { result: TailorResponse }) {
  const n = (k: number) => `${k} rewrite${k === 1 ? '' : 's'}`;
  return (
    <div className="text-sm space-y-1">
      <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 size={14} /> Applied {n(result.applied)}
        {result.tailoredFile ? ' to both versions.' : '. Your base resume is a PDF, so the ATS-safe .docx is the tailored file.'}
      </p>
      {result.unmatched.length > 0 && (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {n(result.unmatched.length)} could not be found in the file and were skipped: {result.unmatched.map((t) => `"${t.original.slice(0, 60)}"`).join(', ')}
        </p>
      )}
    </div>
  );
}

function outputs(app: Listing['application'], result: TailorResponse | null) {
  return {
    report: result?.report ?? app?.atsReport ?? null,
    atsUrl: result?.atsUrl ?? fileUrl(app?.atsR2Key),
    styledUrl: result?.downloadUrl ?? fileUrl(app?.tailoredR2Key),
    message: result?.recruiterMessage ?? app?.recruiterMessage ?? null,
  };
}

function useApproval(analysis: Analysis, resumeId: string) {
  const tweaks = analysis.suggestedTweaks;
  const [approved, setApproved] = useState(() => defaultApproved(tweaks));
  const added = useMemo(() => {
    const forThis = (t: Tweak) => (t.resumeId ?? analysis.recommendedResumeId) === resumeId;
    return new Set(tweaks.filter((t, i) => approved.has(i) && forThis(t)).flatMap((t) => t.adds ?? []));
  }, [tweaks, approved, resumeId, analysis.recommendedResumeId]);
  const toggle = (i: number, on: boolean) => setApproved((prev) => {
    const next = new Set(prev);
    if (on) next.add(i); else next.delete(i);
    return next;
  });
  const chosen = () => tweaks.filter((_, i) => approved.has(i)).map(({ original, rewrite }) => ({ original, rewrite }));
  return { approved, added, toggle, chosen };
}

function useTailorRun(listingId: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<TailorResponse | null>(null);
  const run = async (body: { resumeId: string; tweaks: { original: string; rewrite: string }[] }) => {
    setErr(''); setBusy(true);
    try {
      setResult(await postJson<TailorResponse>(`/api/jobs/${listingId}/tailor`, body));
      onChanged();
    } catch (e) { setErr(errorText(e, 'Tailoring failed')); } finally { setBusy(false); }
  };
  return { busy, err, result, run };
}

export function TailorFlow({ listing, analysis, resumes, onChanged, reanalyze, analyzing }: Props) {
  const app = listing.application;
  const [resumeId, setResumeId] = useState(analysis.recommendedResumeId || app?.resumeId || resumes[0]?.id || '');
  const { approved, added, toggle, chosen } = useApproval(analysis, resumeId);
  const { busy, err, result, run } = useTailorRun(listing.id, onChanged);
  const { report, atsUrl, styledUrl, message } = outputs(app, result);

  return (
    <div className="space-y-4">
      <FitSummary analysis={analysis} resumeId={resumeId} added={added} />
      <TweakList tweaks={analysis.suggestedTweaks} approved={approved} onToggle={toggle} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="px-2 py-1.5 rounded border border-border bg-bg text-sm">
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>{r.label}{r.id === analysis.recommendedResumeId ? ' (recommended)' : ''}</option>
          ))}
        </select>
        <button onClick={() => run({ resumeId, tweaks: chosen() })} disabled={busy || !resumeId} className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Tailor &amp; check
        </button>
        <button onClick={reanalyze} disabled={analyzing} className="text-sm hover:text-accent">{analyzing ? 'Re-analyzing…' : 'Re-analyze'}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {result && <Outcome result={result} />}
      {(report || atsUrl || styledUrl) && (
        <AtsReportView report={report} atsUrl={atsUrl} styledUrl={styledUrl} company={listing.company} title={listing.title} />
      )}
      {message && <RecruiterMessage text={message} />}
      <CoverLetterSection listingId={listing.id} resumeId={resumeId} savedUrl={fileUrl(app?.coverLetterR2Key)} company={listing.company} onChanged={onChanged} />
    </div>
  );
}
