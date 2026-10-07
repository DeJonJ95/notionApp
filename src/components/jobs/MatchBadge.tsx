'use client';
import type { Listing, Match } from './types';

function tone(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (score >= 60) return 'bg-accent/10 text-accent';
  if (score >= 40) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-bg text-muted';
}

const bestAnalysisScore = (l: Listing) =>
  l.analysis?.scores.length ? Math.max(0, ...l.analysis.scores.map((s) => s.score)) : null;

export function fitScore(l: Listing): number | null {
  return bestAnalysisScore(l) ?? l.match?.aiScore ?? null;
}

// AI-scored listings rank above skill-only ones; skill overlap orders the rest.
export function byMatch(a: Listing, b: Listing): number {
  const fa = fitScore(a), fb = fitScore(b);
  if (fa !== null || fb !== null) return (fb ?? -1) - (fa ?? -1);
  return (b.match?.skillScore ?? 0) - (a.match?.skillScore ?? 0);
}

function tooltip(m: Match | null): string {
  if (!m) return '';
  const skills = m.matched.length ? `Your skills in this posting: ${m.matched.join(', ')}` : 'None of your resume skills appear in this posting';
  return [m.label && `Best resume: ${m.label}`, m.reason, m.missing && `Missing: ${m.missing}`, skills].filter(Boolean).join('\n');
}

export function MatchBadge({ listing }: { listing: Listing }) {
  const m = listing.match;
  const fit = fitScore(listing);
  if (fit !== null) {
    return <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${tone(fit)}`} title={tooltip(m)}>{fit}% fit</span>;
  }
  if (!m) return null;
  return (
    <span className="text-xs px-1.5 py-0.5 rounded shrink-0 border border-border text-muted" title={tooltip(m)}>
      {m.matched.length} skill{m.matched.length === 1 ? '' : 's'}
    </span>
  );
}

export function MatchReason({ match }: { match: Match | null }) {
  if (!match?.reason && !match?.matched.length) return null;
  return (
    <div className="text-xs text-muted">
      {match.reason || `Skills found: ${match.matched.slice(0, 8).join(', ')}`}
      {match.missing && <span className="text-amber-700 dark:text-amber-400"> · Missing: {match.missing}</span>}
    </div>
  );
}
