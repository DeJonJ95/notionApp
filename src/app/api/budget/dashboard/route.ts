import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  findOrCreateBudgetDb,
  runRecurringEngine,
  forecastOccurrences,
  detectRecurringPatterns,
  computeRuleVariance,
  occurrencesBetween,
  normalizeBudgetToMonthly,
  monthElapsedPercent,
  computeCategoryBudgets,
  computeAccountBalancesFrom,
  buildBalanceCurve,
  resolveDisplayMonth,
  getBudgetCategories,
  vendorsMatch,
  monthlySavingsContribution,
  goalLedgerAmounts,
  TRANSFERS_CATEGORY,
  type AccountBalance,
  type CategoryBudget,
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
  account: string | null;
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
  month: string;         // the displayed month, YYYY-MM
  currentMonth: string;  // "this" month, YYYY-MM — the forward-navigation limit
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

  const all: Tx[] = [];
  // Envelope targets: Type=Budget rows, normalized to a monthly figure.
  const monthlyBudgets = new Map<string, number>();
  // Type=Savings rows, matched to goals by name further down.
  const savingsRows: { text: string; amount: number }[] = [];
  for (const p of pages) {
    const vals: Record<string, any> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = String(vals['Type'] ?? '');
    if (type === 'Budget') {
      // Not a transaction — it defines a category envelope. Same semantics as
      // the budget-summary view: prefer "Budgeted Amount", fall back to "Amount".
      const cat = String(vals['Category'] ?? '').trim();
      const raw = Math.abs(Number(vals['Budgeted Amount'] ?? 0)) || Math.abs(Number(vals['Amount'] ?? 0));
      if (cat && raw > 0) {
        const period = String(vals['Budget Period'] ?? '');
        monthlyBudgets.set(cat, (monthlyBudgets.get(cat) ?? 0) + normalizeBudgetToMonthly(raw, period));
      }
      continue;
    }
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    if (type === 'Savings') {
      savingsRows.push({
        text: `${vals['Vendor'] ?? p.title ?? ''} ${vals['Notes'] ?? ''}`,
        amount: rawAmt,
      });
    }
    all.push({
      pageId: p.id,
      date: String(vals['Date'] ?? '').slice(0, 10),
      vendor: String(vals['Vendor'] ?? p.title ?? ''),
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      category: String(vals['Category'] ?? 'Other'),
      type,
      account: vals['Account'] == null ? null : String(vals['Account']),
    });
  }

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
  const spendable = all.filter((t) => t.category !== TRANSFERS_CATEGORY);

  const usedThis = spendable.filter((t) => inRange(t.date, displayMonthStart, displayMonthEnd));
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
  let forecast45: ForecastItem[] = [];
  try { forecast45 = await forecastOccurrences(userId, BALANCE_CURVE_DAYS, now); } catch {}
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
  const projectedMonthEnd = (income - expenses) + scheduledNet;

  // ── Account balances + projected balance curve ───────────────────────────
  // Anchored on the closing balance of the latest statement per account, then
  // rolled forward. Without a single statement balance we make no claim.
  let accounts: AccountBalance[] = [];
  try {
    const importLogs = await prisma.importLog.findMany({
      where: { userId },
      select: { account: true, closingBalance: true, dateTo: true },
    });
    accounts = computeAccountBalancesFrom(importLogs, all);
  } catch (e) {
    console.warn('[budget-dashboard] account balances skipped:', (e as Error).message);
  }
  const hasBalances = accounts.some((a) => a.balance != null);
  const totalBalance = Math.round(accounts.reduce((s, a) => s + (a.balance ?? 0), 0) * 100) / 100;
  const { curve: balanceCurve, negativeOn: negativeBalanceDate } = hasBalances
    ? buildBalanceCurve(totalBalance, forecast45, BALANCE_CURVE_DAYS, now)
    : { curve: [] as { date: string; balance: number }[], negativeOn: null as string | null };

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
          const amtMatch = Math.abs(Math.abs(t.amount) - r.amount) / r.amount < 0.3;
          return amtMatch && vendorsMatch(t.vendor, r.name);
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
      for (const due of dueDates) {
        const match = usedThis.find((t) => {
          if (!vendorsMatch(t.vendor, rule.name)) return false;
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
    month: ym(displayMonthStart),
    currentMonth: ym(thisMonthStart),
    income,
    expenses,
    net: income - expenses,
    prevMonth: { income: prevIncome, expenses: prevExpenses, net: prevIncome - prevExpenses },
    expectedVsActual,
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
