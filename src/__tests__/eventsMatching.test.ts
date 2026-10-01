import { normalizeContact, normalizeName, plusOneHost, replacedPlusOnes } from '@/lib/events/names';
import { buildIndex, possibleDuplicates, type MatchablePerson } from '@/lib/events/match';
import { parseGuestText, toRsvp } from '@/lib/events/guestRows';
import { guestRowsFromDatabase } from '@/lib/events/fromDatabase';
import { personStats } from '@/lib/events/stats';
import { suggestInvites } from '@/lib/events/suggest';
import { contactLink, fillMessage } from '@/lib/events/message';

const person = (id: string, name: string, extra: Partial<MatchablePerson> = {}): MatchablePerson => ({
  id, name, aliases: [], contact: null, isPlaceholder: false, ...extra,
});

describe('names', () => {
  it('normalizes emoji, punctuation and case', () => {
    expect(normalizeName('Trunks ⚔️')).toBe('trunks');
    expect(normalizeName('  Chief. ')).toBe('chief');
    expect(normalizeName('DeAngelo Sturgis ')).toBe('deangelo sturgis');
  });
  it('reduces phone numbers to 10 digits and handles to bare names', () => {
    expect(normalizeContact('+1 (313) 555-0101')).toBe('3135550101');
    expect(normalizeContact('@Jordan.H')).toBe('jordan.h');
    expect(normalizeContact('https://instagram.com/jordan.h/')).toBe('jordan.h');
  });
  it('spots Partiful unnamed +1s', () => {
    expect(plusOneHost("Smoke's +1")).toBe('Smoke');
    expect(plusOneHost('Russ')).toBeNull();
  });
});

describe('matching', () => {
  const people = [
    person('1', 'Jordan H', { aliases: ['jordan'], contact: '@jordanh' }),
    person('2', "Yaz's +1", { isPlaceholder: true }),
  ];
  it('finds by contact first, then any spelling, never a placeholder', () => {
    const idx = buildIndex(people);
    expect(idx.find('Somebody Else', '@JordanH')).toBe('1');
    expect(idx.find('JORDAN')).toBe('1');
    expect(idx.find("Yaz's +1")).toBeNull();
  });
  it('flags likely duplicates for review', () => {
    const dupes = possibleDuplicates([person('a', 'Briana'), person('b', 'Briana Cole'), person('c', 'Bri Ana'), person('d', 'Kyle Powell')]);
    expect(dupes.map((d) => `${d.a}${d.b}`).sort()).toEqual(['ab', 'ac']);
  });
});

describe('guest rows', () => {
  it('reads a Partiful export', () => {
    const csv = 'Name,Status,RSVP date,Invited By,Is Plus One Of\nAustin Lee,Going,2026-09-02 13:26:51,,\nRuss,Going,2026-09-02 13:26:51,Austin Lee,Austin Lee\nBrooke,Maybe,2026-09-05 02:04:38,,\n';
    const { rows, partiful } = parseGuestText(csv);
    expect(partiful).toBe(true);
    expect(rows[1]).toMatchObject({ name: 'Russ', rsvp: 'going', source: 'partiful', plusOneOf: 'Austin Lee' });
    expect(rows[2].rsvp).toBe('maybe');
  });
  it('reads a pasted list with the chosen source', () => {
    expect(parseGuestText('Mello, 313-555-0101\nCK', 'dm').rows).toEqual([
      expect.objectContaining({ name: 'Mello', contact: '313-555-0101', source: 'dm' }),
      expect.objectContaining({ name: 'CK', source: 'dm' }),
    ]);
  });
  it('maps a Guest List database, moving Sunday Invite to the next event', () => {
    const { rows, next } = guestRowsFromDatabase([
      { title: 'ALI', values: { Status: 'Going', Source: 'Partiful', Attended: 'Yes', 'Sunday Invite': 'Invited' } },
      { title: 'Doon', values: { Status: 'Going', Attended: 'No', 'Sunday Invite': 'Not invited' } },
    ]);
    expect(rows[0]).toMatchObject({ rsvp: 'going', source: 'partiful', attended: true });
    expect(rows[1].attended).toBe(false);
    expect(next).toEqual([{ name: 'ALI', rsvp: 'invited', source: 'text' }]);
  });
});

describe('personStats', () => {
  it('counts no-shows only for past events', () => {
    const now = new Date('2026-10-01');
    const s = personStats([
      { eventDate: new Date('2026-09-06'), rsvp: 'going', attended: true },
      { eventDate: new Date('2026-09-20'), rsvp: 'going', attended: false },
      { eventDate: new Date('2026-10-04'), rsvp: 'going', attended: false },
    ], now);
    expect(s).toEqual({ attended: 1, rsvps: 3, noShows: 1, lastAttended: new Date('2026-09-06') });
  });
});

describe('toRsvp', () => {
  it('accepts curly apostrophes and extra spaces in Partiful statuses', () => {
    expect(toRsvp('Can’t  Go')).toBe('cant-go');
    expect(toRsvp('Invited')).toBe('invited');
  });
});

describe('suggestInvites', () => {
  const d = (s: string) => new Date(s);
  const history = [
    { personId: 'reg', eventId: 'e1', eventDate: d('2026-08-01'), rsvp: 'going', attended: true },
    { personId: 'reg', eventId: 'e2', eventDate: d('2026-09-06'), rsvp: 'going', attended: true },
    { personId: 'once', eventId: 'e2', eventDate: d('2026-09-06'), rsvp: null, attended: true },
    { personId: 'flake', eventId: 'e2', eventDate: d('2026-09-06'), rsvp: 'going', attended: false },
    { personId: 'flake', eventId: 'e1', eventDate: d('2026-08-01'), rsvp: 'going', attended: false },
    { personId: 'listed', eventId: 'e2', eventDate: d('2026-09-06'), rsvp: 'going', attended: true },
  ];
  const now = d('2026-10-01');
  it('ranks people who came, skipping anyone already listed', () => {
    const r = suggestInvites(history, { fromEventIds: ['e2'], include: 'came', maxNoShows: null }, new Set(['listed']), now);
    expect(r.map((s) => s.personId)).toEqual(['reg', 'once']);
  });
  it('can include RSVPs who did not come, capped by no-shows', () => {
    const all = suggestInvites(history, { fromEventIds: ['e2'], include: 'came-or-rsvped', maxNoShows: null }, new Set(), now);
    expect(all.map((s) => s.personId)).toContain('flake');
    const capped = suggestInvites(history, { fromEventIds: ['e2'], include: 'came-or-rsvped', maxNoShows: 1 }, new Set(), now);
    expect(capped.map((s) => s.personId)).not.toContain('flake');
  });
});

describe('invite messages', () => {
  it('fills the template and picks a channel from the contact', () => {
    expect(fillMessage('Hey {first}! {event} {date} {link}', { name: 'Jordan H', event: 'S+S', date: 'Sun', link: 'x.co' })).toBe('Hey Jordan! S+S Sun x.co');
    expect(contactLink('(313) 555-0101', 'hi')).toEqual({ kind: 'sms', href: 'sms:+13135550101?&body=hi' });
    expect(contactLink('@jordan.h', 'hi')?.kind).toBe('instagram');
    expect(contactLink(null, 'hi')).toBeNull();
  });
});

describe('emoji-only names', () => {
  it('keep a key so the same guest matches on re-import', () => {
    expect(normalizeName('🤍')).toBe('🤍');
    expect(buildIndex([person('e', '🤍 ')]).find('🤍')).toBe('e');
    expect(normalizeName('Kynzi 🤍')).toBe('kynzi');
  });
});

describe('replacedPlusOnes', () => {
  it('drops an unnamed +1 only once the export names that guest', () => {
    const existing = ["smoke's +1", "yaz's +1"];
    const rows = [
      { name: 'Smoke' },
      { name: 'Russ', plusOneOf: 'Smoke' },
      { name: 'Yaz' },
      { name: "Yaz's +1", plusOneOf: 'Yaz' },
    ];
    expect(replacedPlusOnes(rows, existing)).toEqual(["smoke's +1"]);
    expect(replacedPlusOnes([{ name: 'Smoke' }], existing)).toEqual([]);
  });
});

describe('partial check-in events', () => {
  it('are not no-shows in person stats or invite suggestions', () => {
    const now = new Date('2026-10-01');
    expect(personStats([{ eventDate: new Date('2026-09-06'), rsvp: 'going', attended: false, fullCheckIn: false }], now).noShows).toBe(0);
    const r = suggestInvites(
      [{ personId: 'p', eventId: 'e', eventDate: new Date('2026-09-06'), rsvp: 'going', attended: false, fullCheckIn: false }],
      { fromEventIds: ['e'], include: 'came-or-rsvped', maxNoShows: 0 }, new Set(), now,
    );
    expect(r.map((s) => s.personId)).toEqual(['p']);
  });
});
