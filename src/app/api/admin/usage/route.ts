import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const ADMIN_EMAIL = 'dejonj95@gmail.com';

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
  // month
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

  // Group by operation
  const opMap: Record<string, { count: number; inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const l of logs) {
    if (!opMap[l.operation]) opMap[l.operation] = { count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    opMap[l.operation].count++;
    opMap[l.operation].inputTokens += l.inputTokens;
    opMap[l.operation].outputTokens += l.outputTokens;
    opMap[l.operation].costUsd += l.costUsd;
  }

  // Daily buckets for bar chart (last 30 days max)
  const dayMap: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const l of logs) {
    const day = l.createdAt.toISOString().slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    dayMap[day].inputTokens += l.inputTokens;
    dayMap[day].outputTokens += l.outputTokens;
    dayMap[day].costUsd += l.costUsd;
  }

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
    resend,
  });
}
