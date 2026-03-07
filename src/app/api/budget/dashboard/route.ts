import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  runRecurringEngine,
  forecastOccurrences,
  detectRecurringPatterns,
  computeRuleVariance,
  occurrencesBetween,
  type ForecastItem,
  type PatternSuggestion,
  type RuleVariance,
} from '@/lib/budgetDb';

export type Tx = {
  pageId: string;
  date: string;
  vendor: string;
  amount: number;       // signed: negative = expense, positive = income
  category: string;
  type: string;
};

export type Subscription = {
  vendor: string;
  averageAmount: number;
  occurrences: number;
  lastDate: string;
  category: string;
  monthlyEstimate: number;
};

export type RepeatVendor = {
  vendor: string;
  occurrences: number;
  totalAmount: number;
  averageAmount: number;
  lastDate: string;
  category: string;
};

export type DashboardPayload = {
  databaseId: string;
  databaseName: string;
  monthLabel: string;
  income: number;
  expenses: number;
  net: number;
  prevMonth: { income: number; expenses: number; net: number };
  expectedVsActual: {
    incomeExpected: number;
    incomeActual: number;
    expenseExpected: number;
    expenseActual: number;
    rules: { ruleId: string; name: string; type: string; expectedAmt: number; expectedCount: number; matchedCount: number; matchedTotal: number }[];
  };
  byCategory: { category: string; spent: number; pct: number }[];
  excesses: { category: string; spent: number; vsPrior: number; pctChange: number }[];
  subscriptions: Subscription[];
  repeatVendors: RepeatVendor[];
  recentTransactions: Tx[];
  // Recurring + forecast additions
  forecast: ForecastItem[];      // next 14 days of scheduled income/expense
  projectedMonthEnd: number;     // expected net = current + remaining scheduled this month
  generatedThisLoad: number;     // how many tx were auto-created by the engine on this request
  // Spending trends — last 6 calendar months
  trends: { month: string; income: number; expenses: number }[];
  // Feature 5: Pattern auto-detection suggestions
  patternSuggestions: PatternSuggestion[];
  // Feature 4: Variance tracking per rule
  ruleVariance: { ruleId: string; name: string; type: string; amount: number; category: string; variance: RuleVariance }[];
  // Auto-budget: projected income minus savings goals (when no manual budgets set)
  autoBudget: {
    hasManualBudget: boolean;
    monthlyProjectedIncome: number;
    monthlyProjectedExpenses: number;
    monthlySavingsTotal: number;
    availableToBudget: number;
  };
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await findOrCreateBudgetDb(userId);
  // Run the recurring engine BEFORE pulling transactions so any newly-due
  // paychecks/bills are included in the period totals on this same request.
  // Wrapped in try/catch so the dashboard still renders before the
  // RecurringRule table migration is applied.
  let generated = 0;
  try {
    const result = await runRecurringEngine(userId);
    generated = result.generated;
  } catch (e) {
    console.warn('[budget-dashboard] recurring engine skipped:', (e as Error).message);
  }

  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  // Pull every transaction (joins property values keyed by name)
  const pages = await prisma.page.findMany({
    where: { databaseId: db.id, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  const all: Tx[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') continue; // not a transaction
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    all.push({
      pageId: p.id,
      date: String(vals['Date'] ?? '').slice(0, 10),
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      category: String(vals['Category'] ?? 'Other'),
      type,
    });
  }

  // Month windows
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let displayMonthStart = thisMonthStart;
  let displayMonthEnd = nextMonthStart;

  const inRange = (s: string, lo: Date, hi: Date) => {
    const d = new Date(s + 'T00:00:00');
    return d >= lo && d < hi;
  };

  const thisM = all.filter((t) => inRange(t.date, thisMonthStart, nextMonthStart));
  const prevM = all.filter((t) => inRange(t.date, prevMonthStart, thisMonthStart));

  // If "this month" is empty (e.g. statements imported are older), use the
  // most recent month that actually has data so the dashboard isn't blank.
  let usedThis = thisM;
  let usedPrev = prevM;
  let monthLabel = thisMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (thisM.length === 0 && all.length > 0) {
    const latestDate = all
      .map((t) => t.date)
      .sort()
      .at(-1)!;
    const [y, m] = latestDate.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const prevStart = new Date(y, m - 2, 1);
    usedThis = all.filter((t) => inRange(t.date, start, end));
    usedPrev = all.filter((t) => inRange(t.date, prevStart, start));
    monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    displayMonthStart = start;
    displayMonthEnd = end;
  }

  const income = usedThis.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = usedThis.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const prevIncome = usedPrev.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const prevExpenses = usedPrev.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  // Spending by category (current period)
  const catMap = new Map<string, number>();
  for (const t of usedThis) {
    if (t.amount >= 0) continue;
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  const byCategory = Array.from(catMap.entries())
    .map(([category, spent]) => ({
      category,
      spent,
      pct: expenses > 0 ? (spent / expenses) * 100 : 0,
    }))
    .sort((a, b) => b.spent - a.spent);

  // "Excesses" — categories where spending grew >50% vs prior month
  const prevCat = new Map<string, number>();
  for (const t of usedPrev) {
    if (t.amount >= 0) continue;
    prevCat.set(t.category, (prevCat.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  const excesses = byCategory
    .map((c) => {
      const prior = prevCat.get(c.category) ?? 0;
      const delta = c.spent - prior;
      const pctChange = prior > 0 ? ((c.spent - prior) / prior) * 100 : (c.spent > 0 ? 999 : 0);
      return { category: c.category, spent: c.spent, vsPrior: delta, pctChange };
    })
    .filter((e) => e.pctChange > 50 && e.spent > 20)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, 5);

  // Subscription detection: vendor with 2+ expense charges over the trailing
  // 90 days with similar amount (within 15% of mean).
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recent = all.filter((t) => t.amount < 0 && new Date(t.date) >= cutoff);
  const byVendor = new Map<string, Tx[]>();
  for (const t of recent) {
    const key = t.vendor.trim();
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(t);
  }
  const subscriptions: Subscription[] = [];
  for (const [vendor, txs] of byVendor.entries()) {
    if (txs.length < 2) continue;
    const amounts = txs.map((t) => Math.abs(t.amount));
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const inRangeCount = amounts.filter((a) => Math.abs(a - mean) / mean < 0.15).length;
    if (inRangeCount < 2) continue;
    // Don't flag food/groceries/gas as subscriptions
    if (['Food & Dining', 'Transport'].includes(txs[0].category)) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    subscriptions.push({
      vendor,
      averageAmount: Math.round(mean * 100) / 100,
      occurrences: txs.length,
      lastDate: txs.at(-1)!.date,
      category: txs[0].category,
      monthlyEstimate: Math.round(mean * 100) / 100,
    });
  }
  subscriptions.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);

  // ── "Other repeat vendors" — broader list so the user can manually flag
  // anything the strict subscription heuristic missed (food, transport,
  // utilities with variable amounts, car payments, etc.). Excludes vendors
  // already in the subscriptions list above.
  const subVendorSet = new Set(subscriptions.map((s) => s.vendor.toLowerCase().trim()));
  const repeatVendors: RepeatVendor[] = [];
  for (const [vendor, txs] of byVendor.entries()) {
    if (txs.length < 2) continue;
    if (subVendorSet.has(vendor.toLowerCase().trim())) continue;
    const amounts = txs.map((t) => Math.abs(t.amount));
    const total = amounts.reduce((s, a) => s + a, 0);
    const avg = total / amounts.length;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    repeatVendors.push({
      vendor,
      occurrences: txs.length,
      totalAmount: Math.round(total * 100) / 100,
      averageAmount: Math.round(avg * 100) / 100,
      lastDate: txs.at(-1)!.date,
      category: txs[0].category,
    });
  }
  // Sort by total spend descending — biggest impact first
  repeatVendors.sort((a, b) => b.totalAmount - a.totalAmount);

  // ── Spending trends: last 6 calendar months (income vs expenses) ───────
  const trends: { month: string; income: number; expenses: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    let inc = 0;
    let exp = 0;
    for (const t of all) {
      if (!inRange(t.date, start, end)) continue;
      if (t.amount > 0) inc += t.amount;
      else exp += Math.abs(t.amount);
    }
    trends.push({
      month: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      income: Math.round(inc),
      expenses: Math.round(exp),
    });
  }

  const recentTransactions = all.slice(0, 25);

  // ── Forecast: next 14 days of scheduled income/expense ──────────────────
  // Same fallback as above — graceful degradation before the migration runs.
  let forecast: ForecastItem[] = [];
  try { forecast = await forecastOccurrences(userId, 14, now); } catch {}

  // Projected end-of-month net: current month's actual + every scheduled
  // occurrence whose date falls before the end of the displayed month.
  // (Uses the same month window we used for income/expenses above.)
  const monthEnd = thisM.length > 0 || all.length === 0
    ? new Date(nextMonthStart.getTime() - 1)
    : new Date(); // fallback — shouldn't matter, just a safety
  const scheduledThisMonth = forecast.filter((f) => {
    const d = new Date(f.date + 'T00:00:00');
    return d >= now && d <= monthEnd;
  });
  const scheduledNet = scheduledThisMonth.reduce((s, f) => s + f.amount, 0);
  const projectedMonthEnd = (income - expenses) + scheduledNet;

  // ── Pattern auto-detection (Feature 5) ───────────────────────────────────
  let patternSuggestions: PatternSuggestion[] = [];
  try {
    const rules = await prisma.recurringRule.findMany({ where: { userId } });
    const txForPatterns = all.map((t) => ({
      vendor: t.vendor,
      amount: t.amount,
      date: t.date,
      category: t.category,
    }));
    patternSuggestions = detectRecurringPatterns(txForPatterns, rules);
  } catch (e) {
    console.warn('[budget-dashboard] pattern detection skipped:', (e as Error).message);
  }

  // ── Rule variance (Feature 4) ────────────────────────────────────────────
  let ruleVariance: { ruleId: string; name: string; type: string; amount: number; category: string; variance: RuleVariance }[] = [];
  try {
    const rules = await prisma.recurringRule.findMany({ where: { userId, isActive: true } });
    ruleVariance = rules.map((r) => {
      const matchedTxs = all
        .filter((t) => {
          const rn = r.name.toLowerCase().trim();
          const tn = t.vendor.toLowerCase().trim();
          const vendorMatch = tn.includes(rn) || rn.includes(tn);
          const amtMatch = Math.abs(Math.abs(t.amount) - r.amount) / r.amount < 0.3;
          return vendorMatch && amtMatch;
        })
        .map((t) => ({
          date: t.date,
          vendor: t.vendor,
          description: '',
          amount: t.amount,
          category: t.category,
        }));
      return {
        ruleId: r.id,
        name: r.name,
        type: r.type,
        amount: r.amount,
        category: r.category,
        variance: computeRuleVariance(r.amount, matchedTxs),
      };
    });
  } catch (e) {
    console.warn('[budget-dashboard] variance skipped:', (e as Error).message);
  }

  // ── Auto-budget: projected income minus savings goals ───────────────────
  // When no manual Budget rows exist, compute an auto-budget from recurring
  // income rules minus savings goals so the user sees meaningful figures.
  let autoBudget: DashboardPayload['autoBudget'] = {
    hasManualBudget: false,
    monthlyProjectedIncome: 0,
    monthlyProjectedExpenses: 0,
    monthlySavingsTotal: 0,
    availableToBudget: 0,
  };
  try {
    // Check if user has any manual Budget rows
    const budgetPropId = propId['Type'];
    const hasManualBudget = budgetPropId
      ? pages.some((p) => {
          const vals: Record<string, any> = {};
          for (const pv of p.properties) vals[pv.property.name] = pv.value;
          return String(vals['Type'] ?? '') === 'Budget';
        })
      : false;

    // Monthly-normalize recurring rules
    const rules = await prisma.recurringRule.findMany({ where: { userId, isActive: true } });
    const monthlyFactor: Record<string, number> = {
      weekly: 52 / 12,
      biweekly: 26 / 12,
      semimonthly: 24 / 12,
      monthly: 1,
    };
    let monthlyIncome = 0;
    let monthlyExpenses = 0;
    for (const r of rules) {
      const factor = monthlyFactor[r.frequency] ?? 1;
      const monthly = r.amount * factor;
      if (r.type === 'income') monthlyIncome += monthly;
      else monthlyExpenses += monthly;
    }

    // Sum savings goals (use targetAmount as a rough monthly proxy)
    const goals = await prisma.savingsGoal.findMany({ where: { userId } });
    const monthlySavings = goals.reduce((s, g) => s + g.targetAmount, 0);

    autoBudget = {
      hasManualBudget,
      monthlyProjectedIncome: Math.round(monthlyIncome * 100) / 100,
      monthlyProjectedExpenses: Math.round(monthlyExpenses * 100) / 100,
      monthlySavingsTotal: monthlySavings,
      availableToBudget: Math.round(Math.max(0, monthlyIncome - monthlySavings) * 100) / 100,
    };
  } catch (e) {
    console.warn('[budget-dashboard] auto-budget skipped:', (e as Error).message);
  }

  // ── Expected vs Actual ──────────────────────────────────────────────────
  let expectedVsActual: DashboardPayload['expectedVsActual'] = {
    incomeExpected: 0, incomeActual: 0,
    expenseExpected: 0, expenseActual: 0,
    rules: [],
  };
  try {
    const rules = await prisma.recurringRule.findMany({ where: { userId, isActive: true } });
    const ruleResults: DashboardPayload['expectedVsActual']['rules'] = [];
    let totalIncomeExpected = 0;
    let totalExpenseExpected = 0;

    for (const rule of rules) {
      const dueDates = occurrencesBetween(
        rule.anchorDate,
        rule.frequency as 'weekly' | 'biweekly' | 'semimonthly' | 'monthly',
        displayMonthStart,
        new Date(Math.min(displayMonthEnd.getTime(), Date.now())), // don't forecast past today
      );
      if (dueDates.length === 0) continue;

      const expectedCount = dueDates.length;
      const expectedTotal = expectedCount * rule.amount;
      if (rule.type === 'income') totalIncomeExpected += expectedTotal;
      else totalExpenseExpected += expectedTotal;

      // Match each expected occurrence against actual transactions
      let matchedCount = 0;
      let matchedTotal = 0;
      const ruleNorm = rule.name.trim().toLowerCase();
      for (const due of dueDates) {
        const dueStr = due.toISOString().slice(0, 10);
        const match = usedThis.find((t) => {
          const tNorm = t.vendor.trim().toLowerCase();
          const vendorMatch = tNorm.includes(ruleNorm) || ruleNorm.includes(tNorm);
          if (!vendorMatch) return false;
          const tAbs = Math.abs(t.amount);
          if (Math.abs(tAbs - rule.amount) / rule.amount > 0.3) return false;
          const threeDays = 3 * 24 * 60 * 60 * 1000;
          if (Math.abs(new Date(t.date + 'T00:00:00').getTime() - due.getTime()) > threeDays) return false;
          return true;
        });
        if (match) {
          matchedCount++;
          matchedTotal += Math.abs(match.amount);
        }
      }

      ruleResults.push({
        ruleId: rule.id,
        name: rule.name,
        type: rule.type,
        expectedAmt: rule.amount,
        expectedCount,
        matchedCount,
        matchedTotal: Math.round(matchedTotal * 100) / 100,
      });
    }

    const incomeActual = usedThis.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenseActual = usedThis.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    expectedVsActual = {
      incomeExpected: Math.round(totalIncomeExpected * 100) / 100,
      incomeActual: Math.round(incomeActual * 100) / 100,
      expenseExpected: Math.round(totalExpenseExpected * 100) / 100,
      expenseActual: Math.round(expenseActual * 100) / 100,
      rules: ruleResults,
    };
  } catch (e) {
    console.warn('[budget-dashboard] expected-vs-actual skipped:', (e as Error).message);
  }

  const payload: DashboardPayload = {
    databaseId: db.id,
    databaseName: db.name,
    monthLabel,
    income,
    expenses,
    net: income - expenses,
    prevMonth: { income: prevIncome, expenses: prevExpenses, net: prevIncome - prevExpenses },
    expectedVsActual,
    byCategory,
    excesses,
    subscriptions,
    repeatVendors,
    recentTransactions,
    forecast,
    projectedMonthEnd,
    generatedThisLoad: generated,
    trends,
    patternSuggestions,
    ruleVariance,
    autoBudget,
  };

  return NextResponse.json(payload);
}
