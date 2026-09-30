'use client';

import { toast } from '@/components/ui/feedback';
import { api } from './types';

export type Pair = { a: string; b: string; reason: string };
type P = { id: string; name: string; contact: string | null; attended: number };

export function DuplicateList({ pairs, people, onMerged }: { pairs: Pair[]; people: P[]; onMerged: () => void }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const live = pairs.filter((p) => byId.has(p.a) && byId.has(p.b));
  if (live.length === 0) return null;

  const merge = async (keepId: string, mergeId: string) => {
    try {
      await api('/api/people/merge', 'POST', { keepId, mergeId });
      toast.success(`Merged into ${byId.get(keepId)?.name}`);
      onMerged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed');
    }
  };
  const label = (p: P) => `${p.name}${p.contact ? ` (${p.contact})` : ''}, ${p.attended} events`;

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="font-semibold text-text">Could be the same person ({live.length})</h2>
      <ul className="divide-y divide-border text-sm">
        {live.slice(0, 20).map(({ a, b, reason }) => {
          const pa = byId.get(a)!;
          const pb = byId.get(b)!;
          return (
            <li key={`${a}-${b}`} className="flex flex-wrap items-center gap-2 py-2 text-text">
              <span className="flex-1 min-w-[12rem]">{label(pa)} · {label(pb)} <span className="text-xs text-muted">{reason}</span></span>
              <button onClick={() => merge(a, b)} className="px-2 py-1 border border-border rounded hover:bg-surface">Keep {pa.name}</button>
              <button onClick={() => merge(b, a)} className="px-2 py-1 border border-border rounded hover:bg-surface">Keep {pb.name}</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
