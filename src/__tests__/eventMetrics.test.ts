import { arrivals, eventFunnel, rsvpTiming, textEffect, trends, type MRow } from '@/lib/events/metrics';
import { peopleFacts, summarize } from '@/lib/events/peopleMetrics';

const row = (p: Partial<MRow>): MRow => ({
  eventId: 'e1', personId: 'p', rsvp: null, rsvpAt: null, attended: false, checkedInAt: null,
  invitedAt: null, source: 'partiful', guestOfId: null, isPlaceholder: false, ...p,
});

describe('eventFunnel', () => {
  it('counts show rate from going guests and splits new vs returning', () => {
    const f = eventFunnel([
      row({ personId: 'a', rsvp: 'going', attended: true }),
      row({ personId: 'b', rsvp: 'going' }),
      row({ personId: 'c', attended: true, source: 'walk-in' }),
      row({ personId: 'd', rsvp: 'going', attended: true, isPlaceholder: true }),
    ], new Set(['a']));
    expect(f).toMatchObject({ going: 3, came: 3, walkIns: 1, returning: 1, newcomers: 1 });
    expect(f.showRate).toBeCloseTo(2 / 3);
  });
});

describe('textEffect', () => {
  it('credits a text only for yeses that came after it', () => {
    const t = textEffect([
      row({ invitedAt: '2026-10-01T10:00:00Z', rsvp: 'going', rsvpAt: '2026-10-01T12:00:00Z' }),
      row({ invitedAt: '2026-10-01T10:00:00Z', rsvp: 'going', rsvpAt: '2026-09-20T12:00:00Z' }),
      row({ invitedAt: '2026-10-01T10:00:00Z', rsvp: 'invited' }),
      row({ rsvp: 'invited' }),
      row({ rsvp: 'going' }),
    ]);
    expect(t).toEqual({ texted: { n: 2, yes: 1 }, partifulOnly: { n: 2, yes: 1 } });
  });
});

describe('timing', () => {
  it('buckets RSVPs by days before the event and arrivals by half hour', () => {
    const counts = rsvpTiming([
      row({ rsvp: 'going', rsvpAt: '2026-09-01T12:00:00' }),
      row({ rsvp: 'going', rsvpAt: '2026-10-04T09:00:00' }),
      row({ rsvp: 'invited', rsvpAt: '2026-10-04T09:00:00' }),
    ], '2026-10-04T12:00:00');
    expect(counts).toEqual([1, 0, 0, 0, 1]);
    const a = arrivals([
      row({ attended: true, checkedInAt: '2026-10-04T21:10:00' }),
      row({ attended: true, checkedInAt: '2026-10-04T22:40:00' }),
    ]);
    expect(a.map((x) => x.label)).toEqual(['9:00p', '9:30p', '10:00p', '10:30p']);
    expect(a.map((x) => x.count)).toEqual([1, 0, 0, 1]);
  });
});

describe('trends and people', () => {
  const events = [
    { id: 'e1', name: '001', date: '2026-09-06T12:00:00Z' },
    { id: 'e2', name: '002', date: '2026-10-04T12:00:00Z' },
    { id: 'e3', name: '003', date: '2026-11-01T12:00:00Z' },
  ];
  const rows = [
    row({ eventId: 'e1', personId: 'a', rsvp: 'going', attended: true }),
    row({ eventId: 'e1', personId: 'b', rsvp: 'going', attended: true }),
    row({ eventId: 'e1', personId: 'c', rsvp: 'going' }),
    row({ eventId: 'e1', personId: 'x', attended: true, guestOfId: 'a', isPlaceholder: true }),
    row({ eventId: 'e2', personId: 'a', rsvp: 'going', attended: true }),
    row({ eventId: 'e2', personId: 'c', rsvp: 'going' }),
    row({ eventId: 'e2', personId: 'b', rsvp: 'going' }),
    row({ eventId: 'e3', personId: 'b', rsvp: 'going' }),
  ];
  const now = new Date('2026-10-10');
  it('tracks retention and community growth over past events only', () => {
    const t = trends(events, rows, now);
    expect(t.map((x) => [x.came, x.newcomers, x.returning, x.community])).toEqual([[3, 2, 0, 2], [1, 0, 1, 2]]);
    expect(t[0].retained).toBe(0.5);
    expect(t[1].retained).toBeNull();
  });
  it('finds lapsed regulars, repeat no-shows and connectors', () => {
    const s = summarize(peopleFacts(events, [...rows, row({ eventId: 'e2', personId: 'b2', attended: true })], now));
    expect(s.regulars2).toBe(1);
    expect(s.noShowers.map((f) => f.id)).toEqual(['c']);
    expect(s.connectors.map((f) => [f.id, f.brought, f.broughtCame])).toEqual([['a', 1, 1]]);
    expect(s.lapsed).toEqual([]);
    const pastFour = [{ id: 'e0', name: '000', date: '2026-08-01T12:00:00Z' }, ...events];
    const withHistory = [...rows, row({ eventId: 'e0', personId: 'b', attended: true })];
    expect(summarize(peopleFacts(pastFour, withHistory, now)).lapsed.map((f) => f.id)).toEqual(['b']);
  });
});
