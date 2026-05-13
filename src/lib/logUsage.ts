import { prisma } from './prisma';

// DeepSeek V3 pricing (USD per token)
const DS_IN = 0.27 / 1_000_000;
const DS_OUT = 1.10 / 1_000_000;

export async function logDeepSeek(
  operation: string,
  usage: { prompt_tokens: number; completion_tokens: number },
  userId?: string
) {
  try {
    await prisma.usageLog.create({
      data: {
        service: 'deepseek',
        operation,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        costUsd: usage.prompt_tokens * DS_IN + usage.completion_tokens * DS_OUT,
        userId: userId ?? null,
      },
    });
  } catch (err) {
    // Never let logging crash the main request
    console.error('logDeepSeek failed:', err);
  }
}
