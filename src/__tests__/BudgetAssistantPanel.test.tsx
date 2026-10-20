import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BudgetAssistantPanel, SUGGESTED_QUESTIONS } from '../components/budget/assistant/BudgetAssistantPanel';

const reply = {
  reply: 'From Sep 1 to Sep 30, 2026, you spent $60 on fast food.',
  rounds: 2,
  sources: [{
    tool: 'spend_by_merchant_group',
    args: { group: 'fast_food', start_date: '2026-09-01', end_date: '2026-09-30' },
    rows: [{ kind: 'total', month: null, amount: 60, transactions: 3 }, { kind: 'month', month: '2026-09-01', amount: 60, transactions: 3 }],
  }],
};

let sent: { question: string; history: unknown[] }[] = [];

beforeAll(() => {
  // jsdom has no layout, so it lacks scrollIntoView; browsers all have it.
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  sent = [];
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 200, json: async () => reply } as Response;
  });
});

test('offers the four suggested questions and answers one with its sources', async () => {
  render(<BudgetAssistantPanel onClose={() => {}} />);
  for (const q of SUGGESTED_QUESTIONS) expect(screen.getByText(q)).toBeInTheDocument();

  fireEvent.click(screen.getByText('How much did I spend on fast food last month?'));
  expect(await screen.findByText(reply.reply)).toBeInTheDocument();
  expect(sent[0]).toEqual({ question: 'How much did I spend on fast food last month?', history: [] });

  fireEvent.click(screen.getByText('How I got this'));
  expect(screen.getByText('Merchant group spend')).toBeInTheDocument();
  expect(screen.getByText(/Sep 1, 2026 to Sep 30, 2026 · group fast_food/)).toBeInTheDocument();
  expect(screen.getAllByText('60')).toHaveLength(2);
});

test('sends earlier turns as history on a follow-up', async () => {
  render(<BudgetAssistantPanel onClose={() => {}} />);
  fireEvent.click(screen.getByText(SUGGESTED_QUESTIONS[2]));
  await screen.findByText(reply.reply);
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'And in August?' } });
  fireEvent.click(screen.getByLabelText('Send'));
  await screen.findAllByText(reply.reply);
  expect(sent[1].history).toEqual([
    { role: 'user', content: SUGGESTED_QUESTIONS[2] },
    { role: 'assistant', content: reply.reply },
  ]);
});
