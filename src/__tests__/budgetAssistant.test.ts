/** @jest-environment node */
const queryRaw = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    importLog: { findMany: async () => [{ account: 'Checking', dateFrom: new Date('2026-07-01T00:00:00Z'), dateTo: new Date('2026-10-16T00:00:00Z') }] },
    merchantPattern: { count: async () => 2, findMany: async () => [{ id: 'm1', groupName: 'fast_food', pattern: "McDonald's" }, { id: 'm2', groupName: 'delivery', pattern: 'DoorDash' }] },
  },
}));
jest.mock('../lib/budgetDb', () => ({
  findOrCreateBudgetDb: async () => ({ id: 'db1', name: 'Personal Budget', properties: [] }),
  getBudgetCategories: () => ['Food & Dining', 'Transfers'],
}));
jest.mock('../lib/logUsage', () => ({ logDeepSeek: async () => {} }));

import { answerBudgetQuestion, MAX_ROUNDS } from '../lib/budgetAssist/assistant';

type Body = { messages: { role: string; content: string | null; tool_call_id?: string }[]; tools: { function: { name: string; parameters: { properties: Record<string, { enum?: string[] }> } } }[]; temperature: number };
const bodies: Body[] = [];

function replyWith(...messages: Record<string, unknown>[]) {
  let i = 0;
  jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const message = messages[Math.min(i++, messages.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  });
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  bodies.length = 0;
  queryRaw.mockReset();
});

test('runs the tool the model asks for and hands the rows back by call id', async () => {
  queryRaw.mockResolvedValue([{ category: 'Food & Dining', spend: 145, month: new Date('2026-09-01T00:00:00Z') }]);
  replyWith(
    { content: '', tool_calls: [call('c1', 'spend_by_category', { start_date: '2026-09-01', end_date: '2026-09-30' })] },
    { content: 'From Sep 1 to Sep 30, 2026, you spent $145 on Food & Dining.' },
  );
  const out = await answerBudgetQuestion({ userId: 'u1', question: 'How much did I spend on food last month?' });

  expect(out.reply).toContain('$145');
  expect(out.sources).toEqual([{ tool: 'spend_by_category', args: { start_date: '2026-09-01', end_date: '2026-09-30' }, rows: [{ category: 'Food & Dining', spend: 145, month: '2026-09-01' }] }]);
  const sqlArgs = queryRaw.mock.calls[0][0] as { values: unknown[] };
  expect(sqlArgs.values.slice(0, 2)).toEqual(['u1', 'db1']);
  const toolMsg = bodies[1].messages.find((m) => m.role === 'tool');
  expect(toolMsg?.tool_call_id).toBe('c1');
  expect(JSON.parse(String(toolMsg?.content)).rows[0].spend).toBe(145);
  expect(bodies[0].temperature).toBeLessThanOrEqual(0.3);
  expect(bodies[0].messages[0].content).toMatch(/Today in Detroit: \d{4}-\d{2}-\d{2}/);
});

test('offers only the user\'s merchant groups and never a free-form SQL tool', async () => {
  replyWith({ content: 'Done.' });
  await answerBudgetQuestion({ userId: 'u1', question: 'hi' });
  const names = bodies[0].tools.map((t) => t.function.name).sort();
  expect(names).toEqual(['bill_payment_status', 'budget_variance', 'month_over_month', 'month_to_date_pace', 'spend_by_category', 'spend_by_merchant_group', 'top_transactions']);
  const group = bodies[0].tools.find((t) => t.function.name === 'spend_by_merchant_group')?.function.parameters.properties.group;
  expect([...(group?.enum ?? [])].sort()).toEqual(['delivery', 'fast_food']);
});

test('rejects invalid arguments before any query and tells the model why', async () => {
  replyWith(
    { content: '', tool_calls: [
      call('c1', 'spend_by_category', { start_date: '2026-02-30', end_date: '2026-03-31' }),
      call('c2', 'spend_by_merchant_group', { group: 'coffee', start_date: '2026-09-01', end_date: '2026-09-30' }),
      call('c3', 'spend_by_category', { start_date: '2026-09-01', end_date: '2026-09-30', user_id: 'someone-else' }),
      call('c4', 'run_sql', { query: 'select 1' }),
    ] },
    { content: 'I could not run those.' },
  );
  const out = await answerBudgetQuestion({ userId: 'u1', question: 'x' });
  expect(queryRaw).not.toHaveBeenCalled();
  expect(out.sources.map((s) => s.error)).toEqual([
    expect.stringMatching(/Invalid arguments: Not a real date/),
    expect.stringMatching(/Invalid arguments/),
    expect.stringMatching(/Invalid arguments/),
    'Unknown tool run_sql',
  ]);
  const errors = bodies[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(String(m.content)).error);
  expect(errors).toHaveLength(4);
});

test('stops after five rounds of tool calls', async () => {
  queryRaw.mockResolvedValue([]);
  replyWith({ content: '', tool_calls: [call('c', 'bill_payment_status', { start_date: '2026-09-01', end_date: '2026-09-30' })] });
  const out = await answerBudgetQuestion({ userId: 'u1', question: 'loop forever' });
  expect(bodies).toHaveLength(MAX_ROUNDS);
  expect(out.rounds).toBe(MAX_ROUNDS);
  expect(out.reply).toMatch(/five lookups/);
});
