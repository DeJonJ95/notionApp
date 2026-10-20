import { prisma } from '@/lib/prisma';
import { findOrCreateBudgetDb, getBudgetCategories } from '@/lib/budgetDb';
import { statementCoverage } from '@/lib/budgetStatement';
import { chatWithTools, type ChatMessage } from './deepseekTools';
import { merchantGroups } from './merchantGroups';
import { calendarLines, detroitToday } from './periods';
import { runTool, toolDefinitions, type Row, type ToolContext } from './tools';

export const MAX_ROUNDS = 5;
// Rows beyond this still reach the "How I got this" panel, just not the model.
const MAX_ROWS_TO_MODEL = 120;

export type Source = { tool: string; args: Record<string, unknown>; rows: Row[]; error?: string };
export type Turn = { role: 'user' | 'assistant'; content: string };
export type AssistantReply = { reply: string; sources: Source[]; rounds: number };

function systemPrompt(today: string, categories: string[], groups: string[], coveredThrough: string | null): string {
  return [
    'You are the budget assistant for one person, answering questions about their own budget data.',
    'Every number in your reply must come from a tool result in this conversation turn. Never estimate, and never add, subtract, average or compute percentages yourself; restate figures exactly as the tools return them. If an answer needs a calculation no tool provides, say so.',
    'Always state the date range you used.',
    'Lead with the answer, then give the 2 to 4 most important supporting figures. Keep it short. Write plain sentences without em dashes.',
    'If the period or category is ambiguous, pick the default and say which default you picked rather than asking. With no period given, use the last closed month. "Last N months" means the N most recent closed months; include the current partial month only when asked, and then label it partial and use month_to_date_pace for its pace.',
    'Spend means posted outflows. Transfers between the person\'s own accounts and credit card payments (category Transfers) are excluded, forecasts are excluded, and refunds net against the category of the purchase. Payments to other people that were filed under Transfers are excluded too; mention this if it could matter.',
    'Bills are on time when the matched payment posted on or before the due date, late when after (give days late), missed when an imported statement covers the due date and shows no payment, and not confirmed when no statement reaches the due date yet.',
    `Fast food is the merchant group "fast_food"; delivery apps are the separate group "delivery" and are not fast food unless asked. Merchant groups available: ${groups.join(', ') || 'none'}.`,
    `Categories: ${categories.join(', ')}.`,
    ...calendarLines(today),
    coveredThrough ? `Imported bank statements cover dates through ${coveredThrough}; spending after that date is not in the data yet.` : 'No bank statements have been imported yet.',
  ].join('\n');
}

async function coveredThrough(userId: string): Promise<string | null> {
  const logs = await prisma.importLog.findMany({ where: { userId }, select: { account: true, dateFrom: true, dateTo: true } });
  const cov = statementCoverage(logs.map((l) => ({ account: l.account, from: l.dateFrom.toISOString().slice(0, 10), to: l.dateTo.toISOString().slice(0, 10) })));
  return cov?.through ?? null;
}

/** Answers one question: the model picks tools, SQL computes, the model explains. */
export async function answerBudgetQuestion(input: { userId: string; question: string; history?: Turn[] }): Promise<AssistantReply> {
  const db = await findOrCreateBudgetDb(input.userId);
  const groups = Object.keys(await merchantGroups(input.userId));
  const ctx: ToolContext = { userId: input.userId, databaseId: db.id };
  const tools = toolDefinitions(groups);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(detroitToday(), getBudgetCategories(db), groups, await coveredThrough(input.userId)) },
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: 'user', content: input.question },
  ];
  const sources: Source[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { content, toolCalls } = await chatWithTools(messages, tools, { userId: input.userId, temperature: 0.2 });
    if (toolCalls.length === 0) return { reply: content.trim(), sources, rounds: round };
    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const outcome = await runTool(call.function.name, call.function.arguments, groups, ctx);
      sources.push({ tool: call.function.name, ...outcome });
      const payload = outcome.error ? { error: outcome.error } : { rows: outcome.rows.slice(0, MAX_ROWS_TO_MODEL), total_rows: outcome.rows.length };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
    }
  }
  return { reply: 'I could not finish that within five lookups. Try asking about one period or one category at a time.', sources, rounds: MAX_ROUNDS };
}
