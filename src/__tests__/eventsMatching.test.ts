import { normalizeContact, normalizeName, plusOneHost } from '@/lib/events/names';
import { buildIndex, possibleDuplicates, type MatchablePerson } from '@/lib/events/match';
import { parseGuestText } from '@/lib/events/guestRows';
import { guestRowsFromDatabase } from '@/lib/events/fromDatabase';
import { personStats } from '@/lib/events/stats';

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
