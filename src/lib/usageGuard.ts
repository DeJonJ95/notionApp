import { prisma } from './prisma';

// Per-user daily AI spend cap. UsageLog already records costUsd on every
// DeepSeek/Whisper call (see logUsage.ts); this reads it back and refuses
// new AI work once the day's spend crosses the cap. Fail-open on read
// errors — a telemetry hiccup must never block the user's own request.
//
// The cap is intentionally generous for a single-user app; it exists to
// bound accidental runaway loops and abuse if sign-up is ever opened,
// not to ration normal use.

const DEFAULT_CAP_USD = 1.5;

export function dailyCapUsd(): number {
  const raw = Number(process.env.DAILY_AI_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAP_USD;
}

export async function checkDailyBudget(
  userId: string | null | undefined
): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = dailyCapUsd();
  if (!userId) return { ok: true, spentUsd: 0, capUsd };

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  try {
    const agg = await prisma.usageLog.aggregate({
      _sum: { costUsd: true },
      where: { userId, createdAt: { gte: since } },
    });
    const spentUsd = agg._sum.costUsd ?? 0;
    return { ok: spentUsd < capUsd, spentUsd, capUsd };
  } catch (err) {
    console.error('checkDailyBudget failed (allowing request):', err);
    return { ok: true, spentUsd: 0, capUsd };
  }
}

/** Standard 429 body when the cap is hit. */
export function budgetExceededResponse(spentUsd: number, capUsd: number) {
  return {
    error: `Daily AI budget reached ($${spentUsd.toFixed(
      2
    )} of $${capUsd.toFixed(2)}). It resets at midnight UTC.`,
    spentUsd,
    capUsd,
  };
}
