import type { MEvent, MRow } from './metrics';

export type PersonFacts = { id: string; attended: number; noShows: number; brought: number; broughtCame: number; missedLatest: boolean };

/** Per-person tallies behind the regulars, lapsed, no-show and connector
 *  lists. Only events already past count, so an upcoming RSVP is never a miss. */
export function peopleFacts(events: MEvent[], rows: MRow[], now = new Date()): PersonFacts[] {
  const pastIds = new Set(events.filter((e) => new Date(e.date) < now).map((e) => e.id));
  const latest = events.filter((e) => pastIds.has(e.id)).sort((a, b) => b.date.localeCompare(a.date))[0]?.id;
  const facts = new Map<string, PersonFacts>();
  const get = (id: string) => {
    if (!facts.has(id)) facts.set(id, { id, attended: 0, noShows: 0, brought: 0, broughtCame: 0, missedLatest: true });
    return facts.get(id)!;
  };
  for (const r of rows) {
    if (r.isPlaceholder || !pastIds.has(r.eventId)) continue;
    const f = get(r.personId);
    if (r.attended) f.attended++;
    else if (r.rsvp === 'going') f.noShows++;
    if (r.eventId === latest && r.attended) f.missedLatest = false;
  }
  for (const r of rows) {
    if (!r.guestOfId || !pastIds.has(r.eventId)) continue;
    const host = get(r.guestOfId);
    host.brought++;
    if (r.attended) host.broughtCame++;
  }
  return Array.from(facts.values());
}

export function summarize(facts: PersonFacts[]) {
  const by = <K extends keyof PersonFacts>(k: K) => (a: PersonFacts, b: PersonFacts) => Number(b[k]) - Number(a[k]);
  return {
    regulars2: facts.filter((f) => f.attended >= 2).length,
    regulars3: facts.filter((f) => f.attended >= 3).length,
    lapsed: facts.filter((f) => f.attended >= 2 && f.missedLatest).sort(by('attended')),
    noShowers: facts.filter((f) => f.noShows >= 2).sort(by('noShows')),
    connectors: facts.filter((f) => f.brought > 0).sort(by('broughtCame')).slice(0, 8),
  };
}
