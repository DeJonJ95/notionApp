import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const ADMIN_EMAIL = 'dejonj95@gmail.com';

// Google CSE pricing: first 100 queries/day free, then $5 / 1000 = $0.005 each.
// We log every Google call as $0.005; this constant lets the dashboard
// rebate the daily free tier when computing actual money spent.
const GOOGLE_CSE_FREE_DAILY = 100;

function periodStart(period: string): Date {
  const now = new Date();
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get('period') ?? 'month';
  const since = periodStart(period);

  // ── DeepSeek ──────────────────────────────────────────────
  const logs = await prisma.usageLog.findMany({
    where: { service: 'deepseek', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });

  const totalIn = logs.reduce((s, l) => s + l.inputTokens, 0);
  const totalOut = logs.reduce((s, l) => s + l.outputTokens, 0);
  const totalCost = logs.reduce((s, l) => s + l.costUsd, 0);

  const opMap: Record<string, { count: number; inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const l of logs) {
    if (!opMap[l.operation]) opMap[l.operation] = { count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    opMap[l.operation].count++;
    opMap[l.operation].inputTokens += l.inputTokens;
    opMap[l.operation].outputTokens += l.outputTokens;
    opMap[l.operation].costUsd += l.costUsd;
  }

  const dayMap: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const l of logs) {
    const day = l.createdAt.toISOString().slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    dayMap[day].inputTokens += l.inputTokens;
    dayMap[day].outputTokens += l.outputTokens;
    dayMap[day].costUsd += l.costUsd;
  }

  // ── Mood board (every provider, all using the "moodboard:" prefix) ──
  const moodboardLogs = await prisma.usageLog.findMany({
    where: { service: { startsWith: 'moodboard:' }, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });

  const mbByProvider: Record<string, { count: number; costUsd: number }> = {};
  const mbByDay: Record<string, { count: number; costUsd: number; googleCount: number }> = {};
  for (const l of moodboardLogs) {
    const provider = l.service.slice('moodboard:'.length);
    if (!mbByProvider[provider]) mbByProvider[provider] = { count: 0, costUsd: 0 };
    mbByProvider[provider].count++;
    mbByProvider[provider].costUsd += l.costUsd;

    const day = l.createdAt.toISOString().slice(0, 10);
    if (!mbByDay[day]) mbByDay[day] = { count: 0, costUsd: 0, googleCount: 0 };
    mbByDay[day].count++;
    mbByDay[day].costUsd += l.costUsd;
    if (provider === 'google') mbByDay[day].googleCount++;
  }

  // Compute true Google CSE cost after rebating the 100/day free tier
  // per day. Doing it day-by-day rather than period-aggregate so a week
  // with 100 calls across 7 days correctly bills $0 instead of $0.45.
  let googleBilledCost = 0;
  for (const [, day] of Object.entries(mbByDay)) {
    const billable = Math.max(0, day.googleCount - GOOGLE_CSE_FREE_DAILY);
    googleBilledCost += billable * 0.005;
  }

  // ── YouTube transcripts ───────────────────────────────────
  const ytLogs = await prisma.usageLog.findMany({
    where: { service: 'youtube-transcript', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });
  const ytSupadata = ytLogs.filter((l) => l.operation === 'supadata').length;
  const ytFree = ytLogs.filter((l) => l.operation === 'free').length;

  // ── Resend ────────────────────────────────────────────────
  let resend: { emailsSent: number; error: string | null } = { emailsSent: 0, error: null };
  const resendKey = process.env.EMAIL_SERVER_PASSWORD;
  if (resendKey?.startsWith('re_')) {
    try {
      const r = await fetch(
        `https://api.resend.com/emails?limit=100`,
        { headers: { Authorization: `Bearer ${resendKey}` }, next: { revalidate: 0 } }
      );
      if (r.ok) {
        const body = await r.json();
        const emails: Array<{ created_at: string }> = body.data ?? [];
        resend.emailsSent = emails.filter((e) => new Date(e.created_at) >= since).length;
      } else {
        resend.error = `Resend API returned ${r.status}`;
      }
    } catch (err: any) {
      resend.error = err.message;
    }
  } else {
    resend.error = 'No Resend API key (EMAIL_SERVER_PASSWORD must start with re_)';
  }

  return NextResponse.json({
    period,
    since: since.toISOString(),
    deepseek: {
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      totalCostUsd: totalCost,
      callCount: logs.length,
      byOperation: Object.entries(opMap).map(([op, v]) => ({ operation: op, ...v })),
      byDay: Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v })),
    },
    moodboard: {
      totalCalls: moodboardLogs.length,
      // Show both the raw "logged cost" (Google CSE at $0.005 per call)
      // and the true billed cost after free-tier rebate. The dashboard
      // shows `billedCostUsd` as the headline number.
      rawCostUsd: moodboardLogs.reduce((s, l) => s + l.costUsd, 0),
      billedCostUsd: googleBilledCost,
      byProvider: Object.entries(mbByProvider)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([provider, v]) => ({ provider, ...v })),
      byDay: Object.entries(mbByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v })),
      googleFreeDailyLimit: GOOGLE_CSE_FREE_DAILY,
    },
    youtube: {
      totalCalls: ytLogs.length,
      supadataCalls: ytSupadata,
      freeCalls: ytFree,
    },
    resend,
  });
}
