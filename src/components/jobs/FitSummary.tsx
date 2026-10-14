'use client';
import { AlertTriangle } from 'lucide-react';
import type { Analysis } from './types';

type Props = { analysis: Analysis; resumeId: string; added: Set<string> };

function ScoreBars({ analysis }: { analysis: Analysis }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-semibold">Resume fit</h4>
      {analysis.scores.map((s) => (
        <div key={s.resumeId} className="flex items-center gap-2 text-sm">
          <div className="w-28 truncate">{s.label}</div>
          <div className="flex-1 h-2 rounded bg-bg overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, s.score))}%` }} />
          </div>
          <div className="w-10 text-right text-xs">{s.score}%</div>
        </div>
      ))}
    </section>
  );
}

const CHIP = {
  have: 'bg-bg border-border',
  added: 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/40 dark:border-emerald-800 dark:text-emerald-300',
  missing: 'border-dashed border-amber-400 text-amber-800 dark:text-amber-300',
};

function KeywordCoverage({ analysis, resumeId, added }: Props) {
  const have = analysis.coverage?.[resumeId];
  const state = (k: string) => (!have || have.includes(k) ? 'have' : added.has(k) ? 'added' : 'missing');
  const after = have ? have.length + analysis.keywords.filter((k) => !have.includes(k) && added.has(k)).length : 0;
  return (
    <section className="space-y-1.5">
      <h4 className="text-sm font-semibold">ATS keywords</h4>
      {have ? (
        <p className="text-sm">
          Your resume has <strong>{have.length} of {analysis.keywords.length}</strong> word for word
          {after > have.length && <>, <strong>{after}</strong> with the ticked rewrites</>}. ATS search is literal, so spelling counts.
        </p>
      ) : (
        <p className="text-sm">Re-analyze to see which of these your resume already contains.</p>
      )}
      <div className="flex flex-wrap gap-1">
        {analysis.keywords.map((k) => (
          <span key={k} className={`text-xs px-1.5 py-0.5 rounded border ${CHIP[state(k)]}`}>{k}</span>
        ))}
      </div>
    </section>
  );
}

export function FitSummary(props: Props) {
  const { analysis } = props;
  return (
    <div className="space-y-4">
      <ScoreBars analysis={analysis} />
      {analysis.keywords.length > 0 && <KeywordCoverage {...props} />}
      {!!analysis.gaps?.length && (
        <section className="text-sm">
          <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle size={14} /> Not on any of your resumes
          </h4>
          <ul className="list-disc pl-5 space-y-0.5">
            {analysis.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </section>
      )}
      {analysis.atsNotes && <p className="text-sm">{analysis.atsNotes}</p>}
    </div>
  );
}
