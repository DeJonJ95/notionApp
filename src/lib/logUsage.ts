import { prisma } from './prisma';

// DeepSeek V3 pricing (USD per token)
const DS_IN = 0.27 / 1_000_000;
const DS_OUT = 1.10 / 1_000_000;

// Per-call cost for services with a real metered price. Free providers
// default to 0 and we still log them so the dashboard can show
// rate-limit exposure (Unsplash 50/hr etc.) as a count.
//
// Mood-board services use the "moodboard:<provider>" prefix so the
// dashboard can query the whole group with a single startsWith filter.
const PER_CALL_COST: Record<string, number> = {
  // 100/day free, then $5 / 1000 = $0.005 per call. We log the full
  // $0.005 and the dashboard subtracts the free-tier daily allowance
  // when rendering — that way the bar still shows growth even when
  // we're in the free band.
  'moodboard:google': 0.005,
};

export async function logCall(
  service: string,
  operation: string,
  options?: {
    userId?: string;
    costUsd?: number;        // overrides the per-call default lookup
    inputTokens?: number;
    outputTokens?: number;
  }
) {
  try {
    await prisma.usageLog.create({
      data: {
        service,
        operation,
        inputTokens: options?.inputTokens ?? 0,
        outputTokens: options?.outputTokens ?? 0,
        costUsd: options?.costUsd ?? PER_CALL_COST[service] ?? 0,
        userId: options?.userId ?? null,
      },
    });
  } catch (err) {
    // Never let logging crash the main request
    console.error(`logCall(${service}) failed:`, err);
  }
}

// Kept as a thin wrapper so the dozen existing call sites don't need
// to learn the generic signature.
export async function logDeepSeek(
  operation: string,
  usage: { prompt_tokens: number; completion_tokens: number },
  userId?: string
) {
  await logCall('deepseek', operation, {
    userId,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    costUsd: usage.prompt_tokens * DS_IN + usage.completion_tokens * DS_OUT,
  });
}
