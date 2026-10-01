export type MEvent = { id: string; name: string; date: string; fullCheckIn?: boolean };

export type MRow = {
  eventId: string;
  personId: string;
  rsvp: string | null;
  rsvpAt: string | null;
  attended: boolean;
  checkedInAt: string | null;
  invitedAt: string | null;
  source: string | null;
  guestOfId: string | null;
  isPlaceholder: boolean;
};

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
const said = (r: MRow) => r.rsvp === 'going' || r.rsvp === 'maybe';
const DAY = 86_400_000;

/** An unnamed "+1" can't have come before, so they count as new. */
export function eventFunnel(rows: MRow[], cameBefore: Set<string>) {
  const going = rows.filter((r) => r.rsvp === 'going');
  const came = rows.filter((r) => r.attended);
  return {
    listed: rows.length,
    texted: rows.filter((r) => r.invitedAt).length,
    going: going.length,
    maybe: rows.filter((r) => r.rsvp === 'maybe').length,
    came: came.length,
    showRate: going.length ? going.filter((r) => r.attended).length / going.length : null,
    walkIns: came.filter((r) => !said(r)).length,
    returning: came.filter((r) => !r.isPlaceholder && cameBefore.has(r.personId)).length,
    newcomers: came.filter((r) => r.isPlaceholder || !cameBefore.has(r.personId)).length,
  };
}

/** Did a personal text move people? A texted guest counts only if they
 *  hadn't already said yes, and converts if they said yes after the text. */
export function textEffect(rows: MRow[]) {
  const texted = rows.filter((r) => r.invitedAt && !(said(r) && ms(r.rsvpAt) <= ms(r.invitedAt)));
  const convertedAfterText = texted.filter((r) => said(r) && !(ms(r.rsvpAt) <= ms(r.invitedAt)));
  const partifulOnly = rows.filter((r) => !r.invitedAt && r.source === 'partiful');
  return {
    texted: { n: texted.length, yes: convertedAfterText.length },
    partifulOnly: { n: partifulOnly.length, yes: partifulOnly.filter(said).length },
  };
}

export const TIMING_BUCKETS = ['2+ weeks out', '1–2 weeks', '3–6 days', '1–2 days', 'Day of'];

export function rsvpTiming(rows: MRow[], eventDate: string): number[] {
  const counts = TIMING_BUCKETS.map(() => 0);
  const event = new Date(eventDate);
  event.setHours(23, 59, 59, 999);
  for (const r of rows) {
    if (!said(r) || !r.rsvpAt) continue;
    const days = Math.floor((event.getTime() - ms(r.rsvpAt)) / DAY);
    const i = days >= 14 ? 0 : days >= 7 ? 1 : days >= 3 ? 2 : days >= 1 ? 3 : 4;
    counts[i]++;
  }
  return counts;
}

/** Check-ins per half hour in the viewer's local time, first to last arrival. */
export function arrivals(rows: MRow[]): { label: string; count: number }[] {
  const slots = rows
    .filter((r) => r.attended && r.checkedInAt)
    .map((r) => {
      const d = new Date(r.checkedInAt!);
      return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
    });
  if (slots.length === 0) return [];
  const lo = Math.min(...slots);
  const hi = Math.max(...slots);
  return Array.from({ length: hi - lo + 1 }, (_, i) => {
    const slot = lo + i;
    const h = Math.floor(slot / 2);
    const label = `${((h + 11) % 12) + 1}:${slot % 2 ? '30' : '00'}${h < 12 ? 'a' : 'p'}`;
    return { label, count: slots.filter((s) => s === slot).length };
  });
}

/** One row per past event, oldest first. `retained` is the share of this
 *  event's named attendees who came to the next one (null for the latest);
 *  unnamed +1s count as new but can't be tracked into the community. */
export function trends(events: MEvent[], rows: MRow[], now = new Date()) {
  const past = events.filter((e) => new Date(e.date) < now).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const cameAt = past.map((e) => new Set(rows.filter((r) => r.eventId === e.id && r.attended && !r.isPlaceholder).map((r) => r.personId)));
  return past.map((e, i) => {
    const came = rows.filter((r) => r.eventId === e.id && r.attended).length;
    const named = Array.from(cameAt[i]);
    const returning = named.filter((id) => seen.has(id)).length;
    named.forEach((id) => seen.add(id));
    const next = past[i + 1]?.fullCheckIn === false ? undefined : cameAt[i + 1];
    return {
      event: e,
      came,
      returning,
      newcomers: came - returning,
      community: seen.size,
      retained: next && named.length ? named.filter((id) => next.has(id)).length / named.length : null,
    };
  });
}
