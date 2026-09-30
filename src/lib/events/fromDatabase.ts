import { toRsvp, toSource, type GuestRow } from './guestRows';

type DbRow = { title: string; values: Record<string, unknown> };

const text = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));

const NEXT_RSVP: Record<string, string> = { invited: 'invited', confirmed: 'going' };

/** Rows from a database made with the Guest List template. "Sunday Invite"
 *  was the stand-in for the next event, so it becomes that event's RSVPs. */
export function guestRowsFromDatabase(pages: DbRow[]): { rows: GuestRow[]; next: GuestRow[] } {
  const rows: GuestRow[] = [];
  const next: GuestRow[] = [];
  for (const { title, values } of pages) {
    const name = title.trim();
    if (!name || name === 'Untitled') continue;
    const attended = text(values['Attended']);
    rows.push({
      name,
      contact: text(values['Phone / IG']),
      source: toSource(text(values['Source'])),
      rsvp: toRsvp(text(values['Status'])),
      rsvpAt: text(values['RSVP date']),
      attended: attended === undefined ? undefined : attended.toLowerCase() === 'yes',
      invitedBy: text(values['Invited By']),
      plusOneOf: text(values['Is Plus One Of']),
    });
    const invite = NEXT_RSVP[text(values['Sunday Invite'])?.toLowerCase() ?? ''];
    if (invite) next.push({ name, rsvp: invite, source: 'text' });
  }
  return { rows, next };
}
