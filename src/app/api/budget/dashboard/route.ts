import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  runRecurringEngine,
  forecastOccurrences,
  detectRecurringPatterns,
  computeRuleVariance,
  monthElapsedPercent,
  computeCategoryBudgets,
  computeAccountBalancesFrom,
  buildBalanceCurve,
  forecastMonths,
  estimateVariableMonthlySpend,
  type MonthForecast,
  resolveDisplayMonth,
  getBudgetCategories,
  vendorsSimilar,
  monthlySavingsContribution,
  goalLedgerAmounts,
  TRANSFERS_CATEGORY,
  type AccountBalance,
  type CategoryBudget,
  type ForecastItem,
  type PatternSuggestion,
  type RuleVariance,
} from '@/lib/budgetDb';
import {
  computeExpectedVsActual,
  computeOverdueBills,
  emptyExpectedVsActual,
  type ExpectedVsActual,
  type OverdueBill,
} from '@/lib/budgetExpected';
import { readLedger, type Tx } from '@/lib/budgetLedger';
import { detectRepeatVendors, type RepeatVendor, type Subscription } from '@/lib/budgetRepeatVendors';

export type { RepeatVendor, Subscription };

export type DashboardPayload = {
  databaseId: string;
  databaseName: string;
  monthLabel: string;
  month: string;         // the displayed month, YYYY-MM
  currentMonth: string;  // "this" month, YYYY-MM — the forward-navigation limit
  income: number;
  expenses: number;
  net: number;
  prevMonth: { income: number; expenses: number; net: number };
  expectedVsActual: ExpectedVsActual;
  overdueBills: OverdueBill[];
  byCategory: { category: string; spent: number; pct: number }[];
  // Per-category envelope targets (Type=Budget rows) joined to this month's spend
  categoryBudgets: CategoryBudget[];
  // Every category the user can budget against: the DB's Category options
  // plus anything already used by a transaction or envelope row
  categoryOptions: string[];
  excesses: { category: string; spent: number; vsPrior: number; pctChange: number }[];
  subscriptions: Subscription[];
  repeatVendors: RepeatVendor[];
  recentTransactions: Tx[];
  // Account balances + forward-looking balance projection
  accounts: AccountBalance[];
  hasBalances: boolean;          // false until an import carries a closing balance
  totalBalance: number;
  balanceCurve: { date: string; balance: number }[];  // empty when hasBalances is false
  negativeBalanceDate: string | null;
  // Month-by-month projection: scheduled income and bills plus a
  // typical-spending estimate, chained from today's balance
  monthlyForecast: MonthForecast[];
  variableSpendEstimate: number;   // per month, measured from history
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

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Optional ?month=YYYY-MM. Anything malformed is ignored by
  // resolveDisplayMonth, so a bad param degrades to the default view.
  const monthParam = req.nextUrl.searchParams.get('month');

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

  // Pull every transaction (joins property values keyed by name)
  const pages = await prisma.page.findMany({
    where: { databaseId: db.id, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  const { all, monthlyBudgets, savingsRows } = readLedger(pages);

  // Month windows
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const inRange = (s: string, lo: Date, hi: Date) => {
    const d = new Date(s + 'T00:00:00');
    return d >= lo && d < hi;
  };

  const { start: displayMonthStart, end: displayMonthEnd } = resolveDisplayMonth(
    monthParam,
    all.map((t) => t.date),
    now,
  );
  const prevMonthStart = new Date(displayMonthStart.getFullYear(), displayMonthStart.getMonth() - 1, 1);

  // Transfers move money between the user's own accounts, so counting them
  // would double up a credit-card payment (once as the charge, once as the
  // payment). They stay in `all` — recent transactions still list them, and
  // account balances genuinely change when money moves.
  // Forecast rows say a bill is due, never that it was paid, so every total is
  // real money only; `all` keeps them for the transaction list and bill checks.
  const real = all.filter((t) => !t.planned);
  const spendable = real.filter((t) => t.category !== TRANSFERS_CATEGORY);

  const usedThis = spendable.filter((t) => inRange(t.date, displayMonthStart, displayMonthEnd));
  const forecastThis = all.filter((t) =>
    t.planned && t.category !== TRANSFERS_CATEGORY && inRange(t.date, displayMonthStart, displayMonthEnd));
  const usedPrev = spendable.filter((t) => inRange(t.date, prevMonthStart, displayMonthStart));
  const monthLabel = displayMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

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

  // ── Per-category budgets: envelope target vs this month's spend ─────────
  const categoryBudgets = computeCategoryBudgets(
    Array.from(monthlyBudgets, ([category, monthlyAmount]) => ({ category, monthlyAmount })),
    byCategory.map((c) => ({ category: c.category, spent: c.spent })),
    monthElapsedPercent(displayMonthStart, displayMonthEnd, now),
  );

  // Category options every picker offers: the DB's own select options, plus
  // anything already in use so nothing on the dashboard is unreachable.
  const categoryOptionSet = new Set(getBudgetCategories(db));
  for (const c of categoryBudgets) categoryOptionSet.add(c.category);
  const categoryOptions = Array.from(categoryOptionSet).sort((a, b) => a.localeCompare(b));

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

  const { subscriptions, repeatVendors } = detectRepeatVendors(real, now);

  // ── Spending trends: last 6 calendar months (income vs expenses) ───────
  const trends: { month: string; income: number; expenses: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    let inc = 0;
    let exp = 0;
    for (const t of spendable) {
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

  // ── Forecast ─────────────────────────────────────────────────────────────
  // Pull 45 days for the balance curve; the "coming up" list shows 14.
  // Same fallback as above — graceful degradation before the migration runs.
  const BALANCE_CURVE_DAYS = 45;
  const FORECAST_MONTHS = 6;
  // One pull covers everything: the 6-month table, the 45-day curve, and the
  // 14-day list are all slices of the same occurrence set.
  const FORECAST_DAYS = FORECAST_MONTHS * 31 + 31;
  let horizon: ForecastItem[] = [];
  try { horizon = await forecastOccurrences(userId, FORECAST_DAYS, now); } catch {}
  const day45 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + BALANCE_CURVE_DAYS));
  const forecast45 = horizon.filter((f) => f.date <= day45);
  const day14 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14));
  const forecast = forecast45.filter((f) => f.date <= day14);

  // Projected end-of-month net: the displayed month's actual + every scheduled
  // occurrence still to come before that month ends. For a past month nothing
  // is still to come, so this equals the actual net.
  const monthEnd = new Date(displayMonthEnd.getTime() - 1);
  const scheduledThisMonth = forecast45.filter((f) => {
    const d = new Date(f.date + 'T00:00:00');
    return d >= now && d <= monthEnd;
  });
  const scheduledNet = scheduledThisMonth.reduce((s, f) => s + f.amount, 0);
  // Forecasts already due but not confirmed by a statement are still owed.
  const unconfirmedNet = forecastThis.reduce((s, t) => s + t.amount, 0);
  const projectedMonthEnd = (income - expenses) + unconfirmedNet + scheduledNet;

  // ── Account balances + projected balance curve ───────────────────────────
  // Anchored on the closing balance of the latest statement per account, then
  // rolled forward. Without a single statement balance we make no claim.
  let accounts: AccountBalance[] = [];
  try {
    const importLogs = await prisma.importLog.findMany({
      where: { userId },
      select: { account: true, closingBalance: true, dateTo: true },
    });
    accounts = computeAccountBalancesFrom(importLogs, real);
  } catch (e) {
    console.warn('[budget-dashboard] account balances skipped:', (e as Error).message);
  }
  const hasBalances = accounts.some((a) => a.balance != null);
  const totalBalance = Math.round(accounts.reduce((s, a) => s + (a.balance ?? 0), 0) * 100) / 100;
  const { curve: balanceCurve, negativeOn: negativeBalanceDate } = hasBalances
    ? buildBalanceCurve(totalBalance, forecast45, BALANCE_CURVE_DAYS, now)
    : { curve: [] as { date: string; balance: number }[], negativeOn: null as string | null };

  // ── Month-by-month forecast ─────────────────────────────────────────────
  // Scheduled money alone would read far too optimistically, so discretionary
  // spending is estimated from the last 3 complete months and counted too.
  let monthlyForecast: MonthForecast[] = [];
  let variableSpendEstimate = 0;
  try {
    const activeRules = await prisma.recurringRule.findMany({ where: { userId, isActive: true } });
    variableSpendEstimate = estimateVariableMonthlySpend(
      spendable.map((t) => ({ date: t.date, vendor: t.vendor, amount: t.amount })),
      activeRules,
      now,
    );
    monthlyForecast = forecastMonths(horizon, {
      startingBalance: totalBalance,
      months: FORECAST_MONTHS,
      today: now,
      monthlyVariableSpend: variableSpendEstimate,
    });
  } catch (e) {
    console.warn('[budget-dashboard] monthly forecast skipped:', (e as Error).message);
  }

  // ── Pattern auto-detection (Feature 5) ───────────────────────────────────
  let patternSuggestions: PatternSuggestion[] = [];
  try {
    const rules = await prisma.recurringRule.findMany({ where: { userId } });
    const txForPatterns = real.map((t) => ({
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
      const matchedTxs = real
        .filter((t) => {
          const amtMatch = Math.abs(Math.abs(t.amount) - r.amount) / r.amount < 0.3;
          return amtMatch && vendorsSimilar(t.vendor, r.name);
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
    // Manual budgeting is on once at least one envelope row carries an amount.
    const hasManualBudget = monthlyBudgets.size > 0;

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

    // What the goals actually cost per month: remaining amount spread over the
    // months left before each deadline (a year when there is no deadline).
    const goals = await prisma.savingsGoal.findMany({ where: { userId } });
    // Savings-type transactions naming a goal count toward it, same as in the
    // goals modal, so a goal already funded from the ledger costs nothing more.
    const ledger = goalLedgerAmounts(goals, savingsRows);
    const monthlySavings = monthlySavingsContribution(
      goals.map((g) => ({ ...g, currentAmount: g.currentAmount + (ledger[g.id] ?? 0) })),
      now,
    );

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

  let expectedVsActual = emptyExpectedVsActual();
  let overdueBills: OverdueBill[] = [];
  try {
    const rules = await prisma.recurringRule.findMany({ where: { userId, isActive: true } });
    expectedVsActual = computeExpectedVsActual(rules, [...usedThis, ...forecastThis], { start: displayMonthStart, end: displayMonthEnd, now });
    overdueBills = computeOverdueBills(rules, all, now);
  } catch (e) {
    console.warn('[budget-dashboard] expected-vs-actual skipped:', (e as Error).message);
  }

  const payload: DashboardPayload = {
    databaseId: db.id,
    databaseName: db.name,
    monthLabel,
    month: ym(displayMonthStart),
    currentMonth: ym(thisMonthStart),
    income,
    expenses,
    net: income - expenses,
    prevMonth: { income: prevIncome, expenses: prevExpenses, net: prevIncome - prevExpenses },
    expectedVsActual,
    overdueBills,
    byCategory,
    categoryBudgets,
    categoryOptions,
    excesses,
    subscriptions,
    repeatVendors,
    recentTransactions,
    accounts,
    hasBalances,
    totalBalance,
    balanceCurve,
    negativeBalanceDate,
    monthlyForecast,
    variableSpendEstimate,
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
