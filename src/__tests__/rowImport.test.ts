import { parseImportText, normalizeCell } from '@/lib/rowImport';

const partiful = `Name,Status,RSVP date,Invited By,Is Plus One Of
ALI,Going,2026-09-05 20:35:14,,
"Smith, Jo",Maybe,2026-09-04 03:57:26,ALI,ALI
`;

describe('parseImportText', () => {
  it('reads a headed CSV, keeping quoted commas and dropping empty cells', () => {
    const r = parseImportText(partiful, ['Name']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ title: 'ALI', values: { Status: 'Going', 'RSVP date': '2026-09-05 20:35:14' } });
    expect(r.rows[1].title).toBe('Smith, Jo');
  });

  it('treats a headerless paste as one name per line, with an optional contact', () => {
    const r = parseImportText('Jordan H, @jh\nMello\n', ['Name', 'Phone / IG']);
    expect(r.headerless).toBe(true);
    expect(r.rows).toEqual([
      { title: 'Jordan H', values: { 'Phone / IG': '@jh' } },
      { title: 'Mello', values: {} },
    ]);
  });
});

describe('normalizeCell', () => {
  it('trims timestamps to a date and parses numbers and checkboxes', () => {
    expect(normalizeCell('date', '2026-09-05 20:35:14')).toBe('2026-09-05');
    expect(normalizeCell('number', '$1,200')).toBe(1200);
    expect(normalizeCell('checkbox', 'Yes')).toBe(true);
  });
});
