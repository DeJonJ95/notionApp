import { conversationIdFromUrl, normalizeTurns } from '@/lib/claudeChats';

describe('conversationIdFromUrl', () => {
  it('pulls the uuid out of a claude.ai chat URL', () => {
    expect(conversationIdFromUrl('https://claude.ai/chat/9a75fbde-cf09-476e-8ca0-856556b799c4'))
      .toBe('9a75fbde-cf09-476e-8ca0-856556b799c4');
  });

  it('handles a project-scoped chat URL', () => {
    expect(conversationIdFromUrl('https://claude.ai/project/abc123/chat/def456ghi789'))
      .toBe('def456ghi789');
  });

  it('ignores query strings and hashes', () => {
    expect(conversationIdFromUrl('https://claude.ai/chat/abcd1234efgh?foo=bar#top'))
      .toBe('abcd1234efgh');
  });

  it('returns empty string when there is no id — dedup is skipped, not guessed', () => {
    expect(conversationIdFromUrl('https://claude.ai/new')).toBe('');
    expect(conversationIdFromUrl('')).toBe('');
    expect(conversationIdFromUrl(undefined as any)).toBe('');
  });
});

describe('normalizeTurns', () => {
  it('keeps role and text, trimming whitespace', () => {
    expect(normalizeTurns([
      { role: 'user', text: '  hello  ' },
      { role: 'assistant', text: 'hi\n\nthere' },
    ])).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi\n\nthere' },
    ]);
  });

  it('treats any non-user role as assistant', () => {
    const out = normalizeTurns([{ role: 'system', text: 'x' }, { role: 'human', text: 'y' }]);
    expect(out.map((t) => t.role)).toEqual(['assistant', 'assistant']);
  });

  it('drops empty, whitespace-only and malformed entries', () => {
    expect(normalizeTurns([
      { role: 'user', text: '   ' },
      { role: 'user' },
      null,
      'nope',
      { role: 'user', text: 42 },
      { role: 'user', text: 'kept' },
    ])).toEqual([{ role: 'user', text: 'kept' }]);
  });

  it('returns [] for a non-array payload', () => {
    expect(normalizeTurns(undefined)).toEqual([]);
    expect(normalizeTurns({ turns: [] })).toEqual([]);
  });

  it('caps the turn count so a page stays within the 200 blocks /api/extract reads', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ role: 'user', text: `turn ${i}` }));
    expect(normalizeTurns(many)).toHaveLength(200);
  });

  it('clips a single oversized turn rather than dropping it', () => {
    const [turn] = normalizeTurns([{ role: 'assistant', text: 'x'.repeat(50_000) }]);
    expect(turn.text).toHaveLength(20_000);
  });

  it('stops once the whole transcript hits the total budget', () => {
    const big = Array.from({ length: 40 }, () => ({ role: 'assistant', text: 'y'.repeat(20_000) }));
    const out = normalizeTurns(big);
    const total = out.reduce((n, t) => n + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(240_000);
    expect(out.length).toBe(12);
  });
});
