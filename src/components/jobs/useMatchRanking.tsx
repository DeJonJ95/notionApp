'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { byMatch } from './MatchBadge';
import type { Listing } from './types';

type Opts = { listings: Listing[]; hasResumes: boolean; loading: boolean; reload: () => void };

export function useMatchRanking({ listings, hasResumes, loading, reload }: Opts) {
  const [sort, setSort] = useState<'newest' | 'match'>('newest');
  const [ranking, setRanking] = useState(false);
  const [note, setNote] = useState('');

  const rank = useCallback(async (ai: number) => {
    setRanking(true); setNote('');
    try {
      const r = await fetch('/api/jobs/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Ranking failed');
      if (ai) { setNote(`Ranked ${d.ranked} jobs, AI-scored ${d.aiScored} of the top skill matches.`); setSort('match'); }
      reload();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Ranking failed'); }
    finally { setRanking(false); }
  }, [reload]);

  // The skill pass is free, so new captures get one without a click.
  const needsSkillPass = !loading && hasResumes && listings.some((l) => !l.match);
  useEffect(() => { if (needsSkillPass && !ranking) rank(0); }, [needsSkillPass]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = sort === 'match' ? [...listings].sort(byMatch) : listings;
  const bar = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="inline-flex rounded border border-border overflow-hidden">
        {(['newest', 'match'] as const).map((s) => (
          <button key={s} onClick={() => setSort(s)} className={`px-3 py-1 ${sort === s ? 'bg-accent text-white' : 'hover:bg-bg'}`}>
            {s === 'newest' ? 'Newest' : 'Best match'}
          </button>
        ))}
      </div>
      <button onClick={() => rank(10)} disabled={ranking || !hasResumes} className="inline-flex items-center gap-1 px-3 py-1 rounded border border-border hover:border-accent disabled:opacity-50">
        {ranking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Rank matches
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
  return { shown, bar };
}
