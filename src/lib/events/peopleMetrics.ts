import type { MEvent, MRow } from './metrics';

export type PersonFacts = { id: string; attended: number; noShows: number; brought: number; broughtCame: number; missedLatest: boolean };

function windows(events: MEvent[], now: Date) {
  const past = events.filter((e) => new Date(e.date) < now);
  const counted = new Set(past.filter((e) => e.fullCheckIn !== false).map((e) => e.id));
  const latest = past.filter((e) => counted.has(e.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
  // Coming to anything on or after the last fully checked-in event clears a lapse.
  const since = new Set(latest ? past.filter((e) => e.date >= latest.date).map((e) => e.id) : []);
  return { pastIds: new Set(past.map((e) => e.id)), counted, latest, since };
}

/** Per-person tallies behind the regulars, lapsed, no-show and connector
 *  lists. A miss only counts at a past event where everyone was checked in. */
export function peopleFacts(events: MEvent[], rows: MRow[], now = new Date()): PersonFacts[] {
  const { pastIds, counted, latest, since } = windows(events, now);
  const facts = new Map<string, PersonFacts>();
  const get = (id: string) => {
    if (!facts.has(id)) facts.set(id, { id, attended: 0, noShows: 0, brought: 0, broughtCame: 0, missedLatest: latest !== undefined });
    return facts.get(id)!;
  };
  for (const r of rows) {
    if (r.isPlaceholder || !pastIds.has(r.eventId)) continue;
    const f = get(r.personId);
    if (r.attended) f.attended++;
    else if (r.rsvp === 'going' && counted.has(r.eventId)) f.noShows++;
    if (since.has(r.eventId) && r.attended) f.missedLatest = false;
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
