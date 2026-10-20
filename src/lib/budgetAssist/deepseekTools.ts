import { DEEPSEEK_MODEL } from '@/lib/deepseekModel';
import { logDeepSeek } from '@/lib/logUsage';

// Tool calling against DeepSeek's OpenAI-compatible API, using the same model
// config and key as the journal assistant. Thinking stays disabled, so no
// reasoning_content has to be replayed between rounds.

const URL = 'https://api.deepseek.com/chat/completions';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type Opts = { userId: string; temperature: number; timeoutMs?: number };

export function deepseekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/** One completion round. Returns the assistant message, with any tool calls it asked for. */
export async function chatWithTools(messages: ChatMessage[], tools: unknown[], opts: Opts): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('No AI provider is configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...DEEPSEEK_MODEL, messages, tools, tool_choice: 'auto', temperature: opts.temperature, max_tokens: 1500 }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('budget assistant deepseek error:', r.status, (await r.text()).slice(0, 500));
      throw new Error('The assistant could not reach its model. Try again.');
    }
    const j = await r.json();
    if (j.usage) await logDeepSeek('budget-assistant', j.usage, opts.userId);
    const message = j.choices?.[0]?.message ?? {};
    return { content: String(message.content ?? ''), toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [] };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('The assistant took too long. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
