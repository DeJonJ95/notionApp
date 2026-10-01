export type AttendanceFact = { eventDate: Date; rsvp: string | null; attended: boolean; fullCheckIn?: boolean };

export type PersonStats = { attended: number; rsvps: number; noShows: number; lastAttended: Date | null };

/** A no-show is a "going" RSVP to an event that has already happened
 *  without a check-in. Future events, and events where not everyone was
 *  checked in, never count against anyone. */
export function personStats(facts: AttendanceFact[], now = new Date()): PersonStats {
  let attended = 0;
  let rsvps = 0;
  let noShows = 0;
  let lastAttended: Date | null = null;
  for (const f of facts) {
    if (f.rsvp === 'going' || f.rsvp === 'maybe') rsvps++;
    if (f.attended) {
      attended++;
      if (!lastAttended || f.eventDate > lastAttended) lastAttended = f.eventDate;
    } else if (f.rsvp === 'going' && f.eventDate < now && f.fullCheckIn !== false) noShows++;
  }
  return { attended, rsvps, noShows, lastAttended };
}
