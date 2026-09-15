import { extractCarryOver, journalTemplate, nodeText, type TipNode } from '@/lib/journalCarryOver';

const text = (t: string): TipNode => ({ type: 'text', text: t });
const linked = (t: string, href: string): TipNode => ({
  type: 'text',
  text: t,
  marks: [{ type: 'link', attrs: { href } }],
});
const task = (inline: TipNode[], checked: boolean): TipNode => ({
  type: 'taskItem',
  attrs: { checked },
  content: [{ type: 'paragraph', content: inline }],
});
const bullet = (inline: TipNode[]): TipNode => ({
  type: 'listItem',
  content: [{ type: 'paragraph', content: inline }],
});
const heading = (t: string): TipNode => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
const doc = (...content: TipNode[]) => [{ content: { type: 'doc', content } }];

describe('extractCarryOver', () => {
  it('carries unchecked to-dos and drops checked ones', () => {
    const blocks = doc(
      heading("✅ Today's To-Do List"),
      { type: 'taskList', content: [task([text('Ship it')], false), task([text('Done thing')], true)] }
    );
    const out = extractCarryOver(blocks);
    expect(out.map((inline) => nodeText({ content: inline }))).toEqual(['Ship it']);
  });

  it('puts Tomorrow’s Priorities first, then leftovers, without duplicates', () => {
    const blocks = doc(
      heading("✅ Today's To-Do List"),
      { type: 'taskList', content: [task([text('Leftover')], false), task([text('Plan A')], false)] },
      heading('🌅 Tomorrow’s Priorities'),
      { type: 'bulletList', content: [bullet([text('Plan A')]), bullet([text('Plan B')])] }
    );
    const out = extractCarryOver(blocks).map((inline) => nodeText({ content: inline }));
    expect(out).toEqual(['Plan A', 'Plan B', 'Leftover']);
  });

  it('matches the curly-apostrophe heading the evening review writes', () => {
    const blocks = doc(
      { type: 'heading', attrs: { level: 3 }, content: [text('Tomorrow’s priorities')] },
      { type: 'taskList', content: [task([text('From review')], false)] }
    );
    expect(extractCarryOver(blocks).length).toBe(1);
  });

  it('keeps link marks so promoted rows survive the rollover', () => {
    const blocks = doc({ type: 'taskList', content: [task([linked('Fix bug', '/page/abc123')], false)] });
    const [inline] = extractCarryOver(blocks);
    expect(inline[0].marks).toEqual([{ type: 'link', attrs: { href: '/page/abc123' } }]);
  });

  it('reads across several canvas blocks and skips empty items', () => {
    const blocks = [
      { content: { type: 'doc', content: [{ type: 'taskList', content: [task([], false)] }] } },
      { content: { type: 'doc', content: [{ type: 'taskList', content: [task([text('Second block')], false)] }] } },
      { content: null },
    ];
    expect(extractCarryOver(blocks).map((i) => nodeText({ content: i }))).toEqual(['Second block']);
  });

  it('carries the evening review priorities first, even though its heading comes last', () => {
    const blocks = [
      ...doc(
        heading("✅ Today's To-Do List"),
        { type: 'taskList', content: [task([text('Leftover')], false)] },
        heading("🌅 Tomorrow's Priorities"),
        { type: 'bulletList', content: [bullet([])] }
      ),
      ...doc(
        { type: 'heading', attrs: { level: 3 }, content: [text('Tomorrow’s priorities')] },
        { type: 'taskList', content: [task([text('Review pick')], false), task([text('Ticked already')], true)] }
      ),
    ];
    const out = extractCarryOver(blocks).map((i) => nodeText({ content: i }));
    expect(out).toEqual(['Review pick', 'Leftover']);
  });

  it('prefers the linked to-do over a plain bullet with the same text', () => {
    const blocks = doc(
      { type: 'taskList', content: [task([linked('Follow up', '/page/row1')], false)] },
      heading("🌅 Tomorrow's Priorities"),
      { type: 'bulletList', content: [bullet([text('Follow up')])] }
    );
    const out = extractCarryOver(blocks);
    expect(out).toHaveLength(1);
    expect(out[0][0].marks).toEqual([{ type: 'link', attrs: { href: '/page/row1' } }]);
  });

  it('keeps two different rows that share a title', () => {
    const blocks = doc({
      type: 'taskList',
      content: [task([linked('Standup', '/page/a1')], false), task([linked('Standup', '/page/b2')], false)],
    });
    expect(extractCarryOver(blocks)).toHaveLength(2);
  });
});

describe('journalTemplate', () => {
  it('renders one empty to-do when nothing carries over', () => {
    const tpl = journalTemplate([]);
    const list = tpl.content?.find((n) => n.type === 'taskList');
    expect(list?.content).toHaveLength(1);
    expect(nodeText(list?.content?.[0])).toBe('');
  });

  it('renders carried items unchecked in order', () => {
    const tpl = journalTemplate([[text('A')], [text('B')]]);
    const list = tpl.content?.find((n) => n.type === 'taskList');
    expect(list?.content?.map((li) => nodeText(li))).toEqual(['A', 'B']);
    expect(list?.content?.every((li) => li.attrs?.checked === false)).toBe(true);
  });
});
