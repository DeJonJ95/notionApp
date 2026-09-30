export type HistoryRow = { personId: string; eventId: string; eventDate: Date; rsvp: string | null; attended: boolean };

export type SuggestRules = {
  fromEventIds: string[];
  include: 'came' | 'came-or-rsvped';
  maxNoShows: number | null;
};

export type Suggestion = {
  personId: string;
  cameAtSelected: number;
  cameTotal: number;
  noShows: number;
  lastCame: Date | null;
};

type Tally = Suggestion & { qualifies: boolean };

const blank = (personId: string): Tally => ({ personId, cameAtSelected: 0, cameTotal: 0, noShows: 0, lastCame: null, qualifies: false });

function tallyRow(t: Tally, h: HistoryRow, rules: SuggestRules, now: Date) {
  if (h.attended) {
    t.cameTotal++;
    if (!t.lastCame || h.eventDate > t.lastCame) t.lastCame = h.eventDate;
  } else if (h.rsvp === 'going' && h.eventDate < now) t.noShows++;
  if (!rules.fromEventIds.includes(h.eventId)) return;
  if (h.attended) t.cameAtSelected++;
  if (h.attended || (rules.include === 'came-or-rsvped' && h.rsvp === 'going')) t.qualifies = true;
}

/** Who to invite next: people with history at the chosen events, minus
 *  anyone already on the new list, ranked by how reliably they show up. */
export function suggestInvites(history: HistoryRow[], rules: SuggestRules, exclude: Set<string>, now = new Date()): Suggestion[] {
  const byPerson = new Map<string, Tally>();
  for (const h of history) {
    if (exclude.has(h.personId)) continue;
    const t = byPerson.get(h.personId) ?? blank(h.personId);
    tallyRow(t, h, rules, now);
    byPerson.set(h.personId, t);
  }
  return Array.from(byPerson.values())
    .filter((t) => t.qualifies && (rules.maxNoShows === null || t.noShows <= rules.maxNoShows))
    .sort((a, b) => b.cameAtSelected - a.cameAtSelected || b.cameTotal - a.cameTotal || a.noShows - b.noShows)
    .map(({ qualifies: _q, ...s }) => s);
}
