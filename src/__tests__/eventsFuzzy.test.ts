import { editDistance, fuzzyPeople } from '@/lib/events/fuzzy';

const people = [
  { id: '1', name: 'Michael Jordan', contact: '313-555-0101' },
  { id: '2', name: 'Michael', contact: '@mike.b' },
  { id: '3', name: 'Deciah Mahone', aliases: ['Deciah'], contact: null },
  { id: '4', name: 'Kyle Powell', contact: null },
];

describe('fuzzyPeople', () => {
  it('ranks exact, then prefix, then word-prefix matches', () => {
    expect(fuzzyPeople('michael', people).map((p) => p.id)).toEqual(['2', '1']);
    expect(fuzzyPeople('jor', people).map((p) => p.id)).toEqual(['1']);
    expect(fuzzyPeople('mi jo', people).map((p) => p.id)).toEqual(['1']);
  });
  it('forgives typos and finds aliases and contacts', () => {
    expect(fuzzyPeople('mikael', people).map((p) => p.id)).toContain('2');
    expect(fuzzyPeople('decia', people).map((p) => p.id)).toEqual(['3']);
    expect(fuzzyPeople('kyel', people).map((p) => p.id)).toEqual(['4']);
    expect(fuzzyPeople('5550101', people).map((p) => p.id)).toEqual(['1']);
  });
  it('returns nothing for an empty query', () => {
    expect(fuzzyPeople('  ', people)).toEqual([]);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
