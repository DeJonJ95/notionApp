'use client';
import { AlertTriangle } from 'lucide-react';
import type { Tweak } from './types';

type Props = { tweaks: Tweak[]; approved: Set<number>; onToggle: (i: number, on: boolean) => void };

/** Tweaks that add a figure start unticked: the user confirms the number is real. */
export function defaultApproved(tweaks: Tweak[]): Set<number> {
  return new Set(tweaks.flatMap((t, i) => (t.newFigures?.length ? [] : [i])));
}

export function TweakList({ tweaks, approved, onToggle }: Props) {
  if (!tweaks.length) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">Suggested rewrites</h4>
      <p className="text-sm">Each one rewords a line you already have. Tick the ones that are true for you.</p>
      {tweaks.map((t, i) => (
        <label key={i} className="flex gap-2 text-sm border border-border rounded p-2 cursor-pointer">
          <input type="checkbox" checked={approved.has(i)} onChange={(e) => onToggle(i, e.target.checked)} className="mt-1 shrink-0" />
          <div className="min-w-0 space-y-1">
            <div className="line-through decoration-red-400/70">{t.original}</div>
            <div className="font-medium">{t.rewrite}</div>
            {t.reason && <div className="text-xs">{t.reason}</div>}
            <TweakFlags tweak={t} />
          </div>
        </label>
      ))}
    </section>
  );
}

function TweakFlags({ tweak }: { tweak: Tweak }) {
  const adds = tweak.adds ?? [];
  const figures = tweak.newFigures ?? [];
  if (!adds.length && !figures.length) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      {adds.map((k) => (
        <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">+ {k}</span>
      ))}
      {figures.length > 0 && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center gap-1">
          <AlertTriangle size={11} /> New figure: {figures.join(', ')}. Only keep it if it is accurate.
        </span>
      )}
    </div>
  );
}
