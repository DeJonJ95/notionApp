// OpenAI-compatible JSON chat for the journal assistant. DeepSeek by default,
// since its key is already configured and it is the cheapest; setting both
// OPENROUTER_API_KEY and ASSIST_MODEL sends the assistant through OpenRouter.

import { DEEPSEEK_MODEL } from '@/lib/deepseekModel';
import { logCall, logDeepSeek } from '@/lib/logUsage';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// json: whether to send response_format; not every OpenRouter model accepts it, and the prompts ask for JSON anyway.
type Provider = { url: string; key: string; body: Record<string, unknown>; headers: Record<string, string>; name: 'deepseek' | 'openrouter'; json: boolean };

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };

function provider(): Provider | null {
  const orKey = process.env.OPENROUTER_API_KEY;
  const orModel = process.env.ASSIST_MODEL;
  if (orKey && orModel) {
    return {
      name: 'openrouter',
      json: false,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: orKey,
      body: { model: orModel, usage: { include: true } },
      headers: { 'HTTP-Referer': 'https://notionlikeapp.vercel.app', 'X-Title': 'Kove' },
    };
  }
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (!dsKey) return null;
  return { name: 'deepseek', url: 'https://api.deepseek.com/chat/completions', key: dsKey, body: { ...DEEPSEEK_MODEL }, headers: {}, json: true };
}

export function assistConfigured(): boolean {
  return provider() !== null;
}

async function logUsage(p: Provider, op: string, usage: Usage | undefined, userId: string) {
  if (!usage) return;
  const tokens = { prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0 };
  if (p.name === 'deepseek') return logDeepSeek(op, tokens, userId);
  return logCall('openrouter', op, { userId, inputTokens: tokens.prompt_tokens, outputTokens: tokens.completion_tokens, costUsd: usage.cost ?? 0 });
}

type Opts = { op: string; userId: string; maxTokens: number; temperature?: number; timeoutMs?: number };

/** One JSON-mode completion; throws with a user-facing message on failure. */
export async function completeJson(messages: LlmMessage[], opts: Opts): Promise<string> {
  const p = provider();
  if (!p) throw new Error('No AI provider is configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
  try {
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}`, ...p.headers },
      body: JSON.stringify({
        ...p.body,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        ...(p.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error(`assist ${p.name} error:`, r.status, (await r.text()).slice(0, 500));
      throw new Error('The assistant could not reach its model. Try again.');
    }
    const j = await r.json();
    await logUsage(p, opts.op, j.usage, opts.userId);
    return String(j.choices?.[0]?.message?.content ?? '');
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('The assistant took too long. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The outermost JSON object in a reply, tolerating code fences. */
export function parseJsonObject(content: string): Record<string, unknown> {
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('The assistant returned an unreadable answer. Try again.');
  const parsed: unknown = JSON.parse(content.slice(s, e + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The assistant returned an unreadable answer. Try again.');
  return parsed as Record<string, unknown>;
}
