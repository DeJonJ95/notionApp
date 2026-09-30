'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { api, fmtDate } from './types';

type Suggestion = {
  personId: string;
  cameAtSelected: number;
  cameTotal: number;
  noShows: number;
  person?: { id: string; name: string; contact: string | null };
};
type Data = { events: { id: string; name: string; date: string }[]; from: string[]; suggestions: Suggestion[] };

const field = 'bg-bg text-text border border-border rounded px-2 py-1 text-sm';

function SuggestionList({ suggestions, picked, onToggle }: { suggestions: Suggestion[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
          <ul className="max-h-72 overflow-y-auto divide-y divide-border border-y border-border">
            {suggestions.map((s) => (
              <li key={s.personId}>
                <label className="flex items-center gap-2 py-1.5 text-sm text-text">
                  <input type="checkbox" checked={picked.has(s.personId)} onChange={() => onToggle(s.personId)} />
                  <span className="flex-1 truncate">{s.person?.name}</span>
                  <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                    came {s.cameTotal}×{s.noShows ? ` · ${s.noShows} no-show` : ''}{s.person?.contact ? '' : ' · no contact'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
  );
}

export function InviteBuilder({ eventId, onAdded }: { eventId: string; onAdded: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [from, setFrom] = useState<string[] | null>(null);
  const [include, setInclude] = useState('came');
  const [maxNoShows, setMaxNoShows] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    const q = new URLSearchParams({ include, maxNoShows });
    if (from) q.set('from', from.join(','));
    api<Data>(`/api/events/${eventId}/invites?${q}`).then((d) => {
      setData(d);
      setPicked(new Set(d.suggestions.map((s) => s.personId)));
    }).catch(() => toast.error('Could not load suggestions'));
  }, [eventId, from, include, maxNoShows]);
  useEffect(load, [load]);

  if (!data || data.events.length === 0) return null;
  const selected = from ?? data.from;
  const toggleEvent = (id: string) => setFrom(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const togglePerson = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const add = async () => {
    try {
      const r = await api<{ added: number }>(`/api/events/${eventId}/invites`, 'POST', { personIds: Array.from(picked) });
      toast.success(`Added ${r.added} to the invite list`);
      onAdded();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add');
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">Who to invite</h2>
      <div className="space-y-1">
        {data.events.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleEvent(e.id)} />
            {e.name} <span className="text-xs text-muted">{fmtDate(e.date)}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm text-text">
        <select value={include} onChange={(e) => setInclude(e.target.value)} className={field} aria-label="Who counts">
          <option value="came">People who came</option>
          <option value="came-or-rsvped">Came, or RSVP&apos;d going</option>
        </select>
        <select value={maxNoShows} onChange={(e) => setMaxNoShows(e.target.value)} className={field} aria-label="No-show limit">
          <option value="">Any no-shows</option>
          <option value="0">No no-shows</option>
          <option value="1">At most 1 no-show</option>
        </select>
      </div>
      {data.suggestions.length === 0 ? (
        <p className="text-sm text-text">Everyone who matches is already on this list.</p>
      ) : (
        <>
          <SuggestionList suggestions={data.suggestions} picked={picked} onToggle={togglePerson} />
          <button onClick={add} disabled={picked.size === 0} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-50">
            Add {picked.size} to invite list
          </button>
        </>
      )}
    </section>
  );
}
