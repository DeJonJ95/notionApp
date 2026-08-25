import { prisma } from './prisma';
import { DB_TEMPLATES } from './dbTemplates';
import { DEFAULT_CATEGORIES, TRANSFERS_CATEGORY, parseCategoryOptions } from './budgetCategories';

export {
  DEFAULT_CATEGORIES,
  TRANSFERS_CATEGORY,
  parseCategoryOptions,
  fallbackCategory,
} from './budgetCategories';

// The Personal Budget feature works against the user's "Personal Budget"
// database (built from the template). This module finds or creates it.

export type BudgetDb = {
  id: string;
  name: string;
  // `formula` carries select options as JSON for `type='select'` (gotcha 21).
  properties: { id: string; name: string; type: string; formula: string | null }[];
};

/** The user's own Category options, falling back to DEFAULT_CATEGORIES when the
 *  property is missing or its options can't be read. This is what imports and
 *  every category picker should use, so options the user added are honoured. */
export function getBudgetCategories(db: BudgetDb): string[] {
  const prop = db.properties.find((p) => p.name === 'Category');
  if (!prop) return DEFAULT_CATEGORIES;
  return parseCategoryOptions(prop.formula);
}

export async function findOrCreateBudgetDb(userId: string): Promise<BudgetDb> {
  // 1. Look for an existing database the user owns whose schema matches the
  //    Personal Budget template (must have Amount, Date, Category, Vendor).
  const existing = await prisma.database.findFirst({
    where: {
      workspace: { ownerId: userId },
      AND: [
        { properties: { some: { name: 'Amount', type: 'number' } } },
        { properties: { some: { name: 'Date', type: 'date' } } },
        { properties: { some: { name: 'Category' } } },
        { properties: { some: { name: 'Vendor' } } },
      ],
    },
    include: { properties: true },
    orderBy: { createdAt: 'asc' },
  });

  if (existing) {
    let properties = existing.properties;
    // "Account" was added to the template after these databases were created,
    // so backfill it lazily. Optional everywhere — nothing breaks without it.
    if (!properties.some((p) => p.name === 'Account')) {
      const maxPosition = properties.reduce((m, p) => Math.max(m, p.position), 0);
      const created = await prisma.property.create({
        data: {
          name: 'Account',
          type: 'text',
          position: maxPosition + 1024,
          databaseId: existing.id,
        },
      });
      properties = [...properties, created];
    }
    // 'Transfers' is how the dashboard keeps money moved between the user's own
    // accounts out of spending totals, so older databases need the option.
    // Only touched when Category is a select with readable options.
    const categoryProp = properties.find((p) => p.name === 'Category');
    if (categoryProp?.type === 'select' && categoryProp.formula) {
      let options: string[] | null = null;
      try {
        const parsed = JSON.parse(categoryProp.formula);
        if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
      } catch {
        options = null;
      }
      if (options && !options.includes(TRANSFERS_CATEGORY)) {
        const updated = await prisma.property.update({
          where: { id: categoryProp.id },
          data: { formula: JSON.stringify([...options, TRANSFERS_CATEGORY]) },
        });
        properties = properties.map((p) => (p.id === updated.id ? updated : p));
      }
    }
    return {
      id: existing.id,
      name: existing.name,
      properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type, formula: p.formula })),
    };
  }

  // 2. None exists — bootstrap one in the user's first workspace using the
  //    'personal-budget' template.
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
  });
  if (!workspace) throw new Error('No workspace found for user');

  const template = DB_TEMPLATES.find((t) => t.id === 'personal-budget')!;

  const created = await prisma.$transaction(async (tx) => {
    const db = await tx.database.create({
      data: { name: template.name, workspaceId: workspace.id },
    });
    for (let i = 0; i < template.properties.length; i++) {
      const prop = template.properties[i];
      await tx.property.create({
        data: {
          name: prop.name,
          type: prop.type,
          formula: prop.type === 'formula'
            ? (prop.formula ?? null)
            : (prop.options ? JSON.stringify(prop.options) : null),
          position: (i + 1) * 1024,
          databaseId: db.id,
        },
      });
    }
    for (const view of template.views) {
      await tx.view.create({ data: { name: view.name, type: view.type, databaseId: db.id } });
    }
    return tx.database.findUnique({ where: { id: db.id }, include: { properties: true } });
  });

  return {
    id: created!.id,
    name: created!.name,
    properties: created!.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, formula: p.formula })),
  };
}

// ── Recurring transaction engine ───────────────────────────────────────────

export type RuleFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

// Given an anchor date and a frequency, list all occurrence dates from
// `from` (inclusive) up to and including `to` (inclusive). For semimonthly
// the rule generates 2x/month: at anchor's day-of-month and 14 days later
// (or the 15th if anchor.day <= 15, else end-of-month).
export function occurrencesBetween(
  anchor: Date,
  frequency: RuleFrequency,
  from: Date,
  to: Date,
): Date[] {
  if (to < from) return [];
  const result: Date[] = [];
  // ── Weekly/Biweekly: simple stride ──────────────────────────────────────
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const strideDays = frequency === 'weekly' ? 7 : 14;
    // Roll anchor forward in stride steps until we're >= from
    const cursor = new Date(anchor);
    while (cursor < from) cursor.setDate(cursor.getDate() + strideDays);
    while (cursor <= to) {
      result.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + strideDays);
    }
    return result;
  }
  // ── Monthly: same day-of-month each month ───────────────────────────────
  if (frequency === 'monthly') {
    const day = anchor.getDate();
    let y = from.getFullYear();
    let m = from.getMonth();
    // Step back one if `from` is before this month's occurrence
    if (new Date(y, m, day) < from) m++;
    while (true) {
      const d = new Date(y, m, day);
      if (d > to) break;
      if (d >= from) result.push(d);
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return result;
  }
  // ── Semimonthly: anchor day + (anchor day + 14, capped to end-of-month) ─
  if (frequency === 'semimonthly') {
    const day1 = anchor.getDate();
    const day2 = day1 + 14; // may overflow into next month; we clamp below
    let y = from.getFullYear();
    let m = from.getMonth();
    while (true) {
      const lastDay = new Date(y, m + 1, 0).getDate();
      const d1 = new Date(y, m, Math.min(day1, lastDay));
      const d2 = new Date(y, m, Math.min(day2, lastDay));
      for (const d of [d1, d2]) {
        if (d >= from && d <= to) result.push(d);
      }
      m++;
      if (m > 11) { m = 0; y++; }
      if (new Date(y, m, 1) > to) break;
    }
    return result;
  }
  return result;
}

// Next occurrence STRICTLY AFTER the given date.
export function nextOccurrenceAfter(anchor: Date, frequency: RuleFrequency, after: Date): Date {
  const horizonEnd = new Date(after);
  horizonEnd.setFullYear(horizonEnd.getFullYear() + 1);
  const after1 = new Date(after);
  after1.setDate(after1.getDate() + 1);
  const occs = occurrencesBetween(anchor, frequency, after1, horizonEnd);
  return occs[0] ?? horizonEnd;
}

/** Half a rule's period, in days. A real transaction further away than this
 *  belongs to a neighbouring occurrence, not this one. */
export const HALF_PERIOD_DAYS: Record<RuleFrequency, number> = {
  weekly: 3,
  biweekly: 7,
  semimonthly: 7,
  monthly: 14,
};

/** Has this occurrence already been paid for real? Amount is not compared —
 *  a rule's fixed figure rarely equals the actual bill, which is the whole
 *  reason these slip past duplicate detection. */
export function alreadyPaid(
  occurrence: { date: string; amount: number },
  ruleName: string,
  actuals: { date: string; vendor: string; amount: number }[],
  withinDays: number,
): boolean {
  const t = new Date(occurrence.date + 'T00:00:00').getTime();
  if (Number.isNaN(t)) return false;
  const windowMs = withinDays * 86_400_000;

  return actuals.some((a) => {
    if (Math.sign(a.amount) !== Math.sign(occurrence.amount)) return false;
    const at = new Date(a.date + 'T00:00:00').getTime();
    if (Number.isNaN(at) || Math.abs(at - t) > windowMs) return false;
    return vendorsSimilar(a.vendor, ruleName);
  });
}

// Process every active rule for a user — generate any past-due transactions
// up through today, advance the anchor, and update lastGeneratedDate.
export async function runRecurringEngine(userId: string, today: Date = new Date()): Promise<{
  generated: number;
  skipped: number;
}> {
  const rules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true },
  });
  if (rules.length === 0) return { generated: 0, skipped: 0 };

  const db = await findOrCreateBudgetDb(userId);

  // Periods already covered by an imported statement. The statement is the
  // record of what actually happened there, so forecasting into it would
  // double-count the real transaction the import brings in.
  let coverage: { dateFrom: Date; dateTo: Date }[] = [];
  try {
    coverage = await prisma.importLog.findMany({
      where: { userId },
      select: { dateFrom: true, dateTo: true },
    });
  } catch (e) {
    console.warn('[recurring-engine] import coverage unavailable:', (e as Error).message);
  }

  // Real (non-forecast) transactions, so a bill that already posted doesn't get
  // forecast on top of. Coverage-skipping above only helps inside an imported
  // range; a bill paid after the last statement still needs this.
  let actuals: { date: string; vendor: string; amount: number }[] = [];
  try {
    const pages = await prisma.page.findMany({
      where: { databaseId: db.id, isArchived: false },
      include: { properties: { include: { property: { select: { name: true } } } } },
    });
    for (const p of pages) {
      const vals: Record<string, any> = {};
      for (const pv of p.properties) vals[pv.property.name] = pv.value;
      const type = String(vals['Type'] ?? '');
      if (type === 'Budget') continue;
      if (isRecurringGeneratedNote(vals['Notes'])) continue; // another forecast
      const rawAmt = Number(vals['Amount'] ?? 0);
      if (!rawAmt) continue;
      actuals.push({
        date: String(vals['Date'] ?? '').slice(0, 10),
        vendor: String(vals['Vendor'] ?? p.title ?? ''),
        amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      });
    }
  } catch (e) {
    console.warn('[recurring-engine] actuals unavailable:', (e as Error).message);
  }

  let generated = 0;
  let skipped = 0;
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  for (const rule of rules) {
    // Start window: day AFTER the last generated date (so we never duplicate);
    // if never generated, start at the anchor itself.
    const startWindow = rule.lastGeneratedDate
      ? new Date(rule.lastGeneratedDate.getFullYear(), rule.lastGeneratedDate.getMonth(), rule.lastGeneratedDate.getDate() + 1)
      : new Date(rule.anchorDate);

    const due = occurrencesBetween(rule.anchorDate, rule.frequency as RuleFrequency, startWindow, endOfToday);
    if (due.length === 0) continue;

    // Create one transaction per due date
    const transactions: ParsedTransaction[] = due.map((d) => {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const signed = rule.type === 'income' ? rule.amount : -rule.amount;
      return {
        date: iso,
        vendor: rule.name,
        description: recurringNote(rule.type, rule.name),
        amount: signed,
        category: rule.category,
        // A forecast, not money the bank has confirmed. Marking it 'Planned'
        // is what lets an import supersede it later.
        status: 'Planned',
      };
    });
    // Drop occurrences the ledger already accounts for: inside an imported
    // statement's range, or already paid for real near the due date.
    const nearDays = HALF_PERIOD_DAYS[rule.frequency as RuleFrequency] ?? 14;
    const toWrite = transactions.filter(
      (t) => !isDateCovered(t.date, coverage) && !alreadyPaid(t, rule.name, actuals, nearDays),
    );
    skipped += transactions.length - toWrite.length;
    if (toWrite.length > 0) {
      await writeTransactions(userId, db.id, toWrite);
      generated += toWrite.length;
    }

    // Advance anchor + lastGeneratedDate
    const lastDue = due[due.length - 1];
    const nextAnchor = nextOccurrenceAfter(rule.anchorDate, rule.frequency as RuleFrequency, lastDue);
    await prisma.recurringRule.update({
      where: { id: rule.id },
      data: {
        anchorDate: nextAnchor,
        lastGeneratedDate: lastDue,
      },
    });
  }

  if (skipped > 0) {
    console.log(`[recurring-engine] skipped ${skipped} occurrence(s) already covered by an import`);
  }
  return { generated, skipped };
}

export type ForecastItem = {
  date: string;
  amount: number;       // signed: + = income, - = expense
  name: string;
  category: string;
  type: string;
  ruleId: string;
};

// Forward-looking forecast: every scheduled occurrence in the next N days.
export async function forecastOccurrences(userId: string, days: number, today: Date = new Date()): Promise<ForecastItem[]> {
  const rules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true },
  });
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const out: ForecastItem[] = [];
  for (const rule of rules) {
    const occs = occurrencesBetween(rule.anchorDate, rule.frequency as RuleFrequency, start, end);
    for (const d of occs) {
      out.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        amount: rule.type === 'income' ? rule.amount : -rule.amount,
        name: rule.name,
        category: rule.category,
        type: rule.type,
        ruleId: rule.id,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export type ParsedTransaction = {
  date: string;        // ISO YYYY-MM-DD
  vendor: string;
  description: string;
  amount: number;      // negative = expense, positive = income
  category: string;    // one of DB Category options
  account?: string;    // which account this came from, when known
  status?: string;     // 'Cleared' (real money) or 'Planned' (forecast). Default 'Cleared'.
};

// ── Recurring-generated rows ────────────────────────────────────────────

/** Notes text stamped on every row the recurring engine creates. It is the
 *  only marker distinguishing a forecast row from one the user or an import
 *  put there, so both the engine and the import cleanup key off it. */
export function recurringNote(type: string, name: string): string {
  return `Recurring ${type}: ${name}`;
}

export function isRecurringGeneratedNote(note: unknown): boolean {
  return /^Recurring (income|expense): /.test(String(note ?? ''));
}

export type LedgerDuplicate = {
  pageId: string;   // the row proposed for removal
  date: string;
  vendor: string;
  amount: number;
  reason: 'forecast-superseded' | 'repeat-import';
  matched: { date: string; vendor: string; amount: number };  // the row being kept
};

/** Alias kept for the original single-purpose name. */
export type ForecastCollision = LedgerDuplicate;

/** Find recurring forecast rows that the real transaction has since landed on
 *  top of. Amount is deliberately NOT compared: the whole reason these survive
 *  normal dedup is that a rule's fixed amount rarely equals the real paycheck
 *  or a variable bill. Instead: a similar vendor, the same direction of money,
 *  and a nearby date.
 *
 *  Only rows flagged `isGenerated` are ever proposed for removal, and only when
 *  a NON-generated row corroborates them, so two forecasts can't cancel out. */
/** Below this, a same-day same-amount pair is far more likely to be genuine
 *  (verification trial deposits and their refund, interest, small fees) than a
 *  re-import, so the repeat-import pass leaves it alone. */
export const MICRO_TRANSACTION_LIMIT = 1;

const cents = (n: number) => Math.round(n * 100);

/** How far a real transaction may sit from the forecast it supersedes. Bills
 *  post early or late against a rule's anchor — an insurance premium anchored
 *  to the 25th can clear on the 14th — so a few days is far too tight. Stays
 *  under half a monthly period, so it can't reach an adjacent occurrence. */
export const FORECAST_MATCH_WINDOW_DAYS = 14;

export function findLedgerDuplicates(
  rows: { pageId: string; date: string; vendor: string; amount: number; isGenerated: boolean }[],
  windowDays = FORECAST_MATCH_WINDOW_DAYS,
): LedgerDuplicate[] {
  const windowMs = windowDays * 86_400_000;
  const time = (d: string) => new Date(d + 'T00:00:00').getTime();
  const out: LedgerDuplicate[] = [];
  // Rows already spoken for, as either the kept or the removed side, so a
  // single transaction can't be counted into two different pairs.
  const spent = new Set<string>();

  // ── Pass 1: a forecast the real transaction landed on top of ────────────
  // Amount is NOT compared — a rule's fixed amount rarely equals reality, which
  // is exactly why these survive import dedup.
  const real = rows.filter((r) => !r.isGenerated);
  // Collect every plausible pairing, then settle the closest ones first. With a
  // window this wide, taking the first match in array order would happily pair
  // a forecast with a transaction that belongs to the occurrence next door.
  type Pair = { forecast: (typeof rows)[number]; hit: (typeof rows)[number]; distance: number };
  const pairs: Pair[] = [];
  for (const forecast of rows) {
    if (!forecast.isGenerated) continue;
    const t = time(forecast.date);
    if (Number.isNaN(t)) continue;

    for (const r of real) {
      if (Math.sign(r.amount) !== Math.sign(forecast.amount)) continue;
      const rt = time(r.date);
      if (Number.isNaN(rt)) continue;
      const distance = Math.abs(rt - t);
      if (distance > windowMs) continue;
      if (!vendorsSimilar(r.vendor, forecast.vendor)) continue;
      pairs.push({ forecast, hit: r, distance });
    }
  }
  pairs.sort((a, b) =>
    a.distance - b.distance || a.forecast.pageId.localeCompare(b.forecast.pageId),
  );

  for (const { forecast, hit } of pairs) {
    if (spent.has(forecast.pageId) || spent.has(hit.pageId)) continue;
    spent.add(hit.pageId);
    spent.add(forecast.pageId);
    out.push({
      pageId: forecast.pageId,
      date: forecast.date,
      vendor: forecast.vendor,
      amount: forecast.amount,
      reason: 'forecast-superseded',
      matched: { date: hit.date, vendor: hit.vendor, amount: hit.amount },
    });
  }

  // ── Pass 2: the same real transaction imported twice ────────────────────
  // Stricter than pass 1 on purpose: identical date AND identical amount, so
  // two genuine same-day charges of different sizes are never touched. Rows
  // arrive oldest-first, so the original is kept and the later copy removed.
  for (let i = 0; i < rows.length; i++) {
    const later = rows[i];
    if (later.isGenerated || spent.has(later.pageId)) continue;
    if (!time(later.date)) continue;
    // Tiny amounts are where legitimate near-identical pairs actually live:
    // account-verification trial deposits and their reversal, interest, small
    // fees. Removing one would be wrong, and a duplicate this size moves no
    // total worth the risk.
    if (Math.abs(later.amount) < MICRO_TRANSACTION_LIMIT) continue;

    for (let j = 0; j < i; j++) {
      const original = rows[j];
      if (original.isGenerated || spent.has(original.pageId)) continue;
      if (original.date !== later.date) continue;
      // Exact to the cent. A tolerance would make 0.01 and 0.02 "equal".
      if (cents(original.amount) !== cents(later.amount)) continue;
      if (!vendorsSimilar(original.vendor, later.vendor)) continue;

      spent.add(original.pageId);
      spent.add(later.pageId);
      out.push({
        pageId: later.pageId,
        date: later.date,
        vendor: later.vendor,
        amount: later.amount,
        reason: 'repeat-import',
        matched: { date: original.date, vendor: original.vendor, amount: original.amount },
      });
      break;
    }
  }
  return out;
}

/** Previous name, when this only handled the forecast case. */
export const findForecastCollisions = findLedgerDuplicates;

/** Is `date` inside any imported statement's coverage? A statement is the
 *  authoritative record for its period, so the engine must not invent a
 *  transaction there and an import supersedes any forecast already written. */
export function isDateCovered(
  date: string,
  ranges: { dateFrom: Date; dateTo: Date }[],
): boolean {
  return ranges.some((r) => date >= ymdOf(r.dateFrom) && date <= ymdOf(r.dateTo));
}

// Bulk-write transactions as pages with property values.
export async function writeTransactions(
  userId: string,
  databaseId: string,
  transactions: ParsedTransaction[]
): Promise<{ created: number }> {
  const db = await prisma.database.findFirst({
    where: { id: databaseId, workspace: { ownerId: userId } },
    include: { properties: true },
  });
  if (!db) throw new Error('Budget database not found');

  // Build a name → propertyId lookup
  const propId: Record<string, string> = {};
  for (const p of db.properties) propId[p.name] = p.id;

  const requiredProps = ['Type', 'Category', 'Amount', 'Date', 'Vendor', 'Status'];
  for (const name of requiredProps) {
    if (!propId[name]) throw new Error(`Budget DB missing property: ${name}`);
  }

  let created = 0;
  for (const tx of transactions) {
    const type = tx.amount >= 0 ? 'Income' : 'Expense';
    const page = await prisma.page.create({
      data: {
        title: tx.vendor || tx.description.slice(0, 60),
        workspaceId: db.workspaceId,
        databaseId: db.id,
        authorId: userId,
        position: Date.now() + created,
      },
    });
    const writes: { propertyId: string; value: any }[] = [
      { propertyId: propId['Type'],     value: type },
      { propertyId: propId['Category'], value: tx.category },
      { propertyId: propId['Amount'],   value: Math.abs(tx.amount) },
      { propertyId: propId['Date'],     value: tx.date },
      { propertyId: propId['Status'],   value: tx.status ?? 'Cleared' },
      { propertyId: propId['Vendor'],   value: tx.vendor },
    ];
    if (propId['Notes'] && tx.description !== tx.vendor) {
      writes.push({ propertyId: propId['Notes'], value: tx.description });
    }
    // Optional, like Notes — older budget DBs may not have the property yet.
    if (propId['Account'] && tx.account?.trim()) {
      writes.push({ propertyId: propId['Account'], value: tx.account.trim() });
    }
    await prisma.propertyValue.createMany({
      data: writes.map((w) => ({ ...w, pageId: page.id })),
    });
    created++;
  }
  return { created };
}

// ── Savings goals ───────────────────────────────────────────────────────

/** Whole months left before `deadline`, rounded up, never less than 1.
 *  Calendar arithmetic rather than average-day division, which would read two
 *  long months (61 days) as 2.004 and round them up to 3. */
export function monthsUntil(deadline: Date, now: Date): number {
  const months =
    (deadline.getFullYear() - now.getFullYear()) * 12 + (deadline.getMonth() - now.getMonth());
  // A deadline falling later in its month needs one more month of saving.
  const partial = deadline.getDate() > now.getDate() ? 1 : 0;
  return Math.max(1, months + partial);
}

/** Money already put toward each goal by Type='Savings' transactions, keyed by
 *  goal id. A transaction counts toward a goal when the goal's name appears in
 *  its vendor or notes (normalized, so casing and punctuation don't matter).
 *  Goal names under 3 characters are ignored — too weak to match on. */
export function goalLedgerAmounts(
  goals: { id: string; name: string }[],
  savingsTransactions: { text: string; amount: number }[],
): Record<string, number> {
  const normalizedTxs = savingsTransactions.map((t) => ({
    text: normalizeVendor(t.text),
    amount: t.amount,
  }));

  const out: Record<string, number> = {};
  for (const goal of goals) {
    const needle = normalizeVendor(goal.name);
    let total = 0;
    if (needle.length >= 3) {
      for (const t of normalizedTxs) {
        if (t.text && t.text.includes(needle)) total += t.amount;
      }
    }
    out[goal.id] = Math.round(total * 100) / 100;
  }
  return out;
}

/** What the user must set aside per month to hit their goals: each goal's
 *  REMAINING amount spread over the months left before its deadline. A goal
 *  with no deadline is spread over a year. Already-funded goals cost nothing.
 *
 *  This replaced summing `targetAmount`, which treated a goal's lifetime total
 *  as a monthly cost and made "available to budget" wildly pessimistic. */
export function monthlySavingsContribution(
  goals: { targetAmount: number; currentAmount: number; deadline: Date | null }[],
  now: Date = new Date(),
): number {
  let total = 0;
  for (const g of goals) {
    const remaining = Math.max(0, g.targetAmount - g.currentAmount);
    if (remaining === 0) continue;
    const months = g.deadline ? monthsUntil(g.deadline, now) : 12;
    total += remaining / months;
  }
  return Math.round(total * 100) / 100;
}

// ── Categorization rules ────────────────────────────────────────────────

export type CategorizationRuleLike = {
  match: string;
  category: string;
  minAmount?: number | null;
  maxAmount?: number | null;
};

/** Pick the rule that forces a transaction's category, or null.
 *
 *  The vendor must contain the rule's (lowercased) match text, and the amount
 *  must fall inside whatever bounds the rule sets. Bounds compare against the
 *  ABSOLUTE amount so the user can think in plain dollars without worrying
 *  about the income/expense sign.
 *
 *  Specificity wins: a rule with amount bounds beats an unbounded one, and
 *  among equals the longest match text wins. That is what lets "zelle" over
 *  $200 mean family support while smaller Zelle activity falls through to a
 *  broader rule. */
export function matchCategorizationRule<T extends CategorizationRuleLike>(
  vendor: string,
  amount: number,
  rules: T[],
): T | null {
  const v = String(vendor ?? '').toLowerCase();
  const abs = Math.abs(amount);

  const candidates = rules.filter((r) => {
    const m = String(r.match ?? '').toLowerCase().trim();
    if (!m || !v.includes(m)) return false;
    if (r.minAmount != null && abs < r.minAmount) return false;
    if (r.maxAmount != null && abs > r.maxAmount) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const bounded = (r: CategorizationRuleLike) =>
    r.minAmount != null || r.maxAmount != null ? 1 : 0;

  return candidates.reduce((best, r) => {
    if (bounded(r) !== bounded(best)) return bounded(r) > bounded(best) ? r : best;
    return String(r.match).length > String(best.match).length ? r : best;
  });
}

// ── Vendor name matching ────────────────────────────────────────────────

// Words that carry no identity and only get in the way of matching.
const VENDOR_NOISE_WORDS = new Set(['inc', 'llc', 'llp', 'ltd', 'co', 'corp', 'the']);

/** Reduce a raw statement vendor to its identifying words: lowercase, strip
 *  punctuation and store/reference numbers, drop legal-suffix noise.
 *  "AMAZON PRIME*JH5BA8CS3 440" and "Amazon Prime, Inc." both become
 *  "amazon prime jh5ba8cs3" / "amazon prime". */
export function normalizeVendor(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d{3,}$/.test(w) && !VENDOR_NOISE_WORDS.has(w))
    .join(' ')
    .trim();
}

// Connector words that say nothing about identity. Ignored when scoring token
// overlap, so "City of Detroit" doesn't get credit for matching on "of".
const VENDOR_CONNECTORS = new Set(['of', 'and', 'for', 'to', 'at', 'in', 'on', 'a']);

function vendorTokens(s: string): string[] {
  return normalizeVendor(s)
    .split(' ')
    .filter((t) => t && !VENDOR_CONNECTORS.has(t));
}

/** Looser match for correlating a RECURRING RULE's name against a statement's
 *  vendor wording. Those come from different vocabularies — a rule called
 *  "City of Detroit Paycheck" has to line up with "CITY OF DETROIT PAYROLL
 *  2606231026" — so containment alone never fires. Falls back to token
 *  overlap: at least 2 shared identifying words, covering at least half of the
 *  shorter name.
 *
 *  Deliberately NOT used by `findDuplicateTransactions`: there a false
 *  positive silently discards a real transaction. Every caller of this pairs
 *  it with an amount check (within 30%), which is what separates, say, a
 *  "City of Detroit Paycheck" rule from a "City of Detroit Water" charge. */
export function vendorsSimilar(a: string, b: string): boolean {
  if (vendorsMatch(a, b)) return true;

  const ta = vendorTokens(a);
  const tb = vendorTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;

  const setB = new Set(tb);
  const shared = new Set(ta.filter((t) => setB.has(t))).size;
  if (shared < 2) return false;

  return shared / Math.min(ta.length, tb.length) >= 0.5;
}

/** Two-way containment on normalized names. The shorter side must be at least
 *  4 characters, so a stray fragment can't match half the ledger. */
export function vendorsMatch(a: string, b: string): boolean {
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

// ── Cross-import duplicate detection ────────────────────────────────────

export type DuplicateMatch = {
  incoming: ParsedTransaction;
  matched: { date: string; vendor: string; amount: number };
};

/** Find incoming transactions that look like they already exist in the DB.
 *  Match criteria: vendor (case-insensitive contains), amount (absolute value),
 *  and date within ±3 days. */
export function findDuplicateTransactions(
  existing: { date: string; vendor: string; amount: number }[],
  incoming: ParsedTransaction[],
): DuplicateMatch[] {
  const results: DuplicateMatch[] = [];
  for (const tx of incoming) {
    const absAmt = Math.abs(tx.amount);
    const txDate = new Date(tx.date + 'T00:00:00');
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const match = existing.find((e) => {
      if (!vendorsMatch(e.vendor, tx.vendor)) return false;
      // Amount: absolute value match
      if (Math.abs(Math.abs(e.amount) - absAmt) > 0.01) return false;
      // Date: within ±3 days
      const eDate = new Date(e.date + 'T00:00:00');
      if (Math.abs(eDate.getTime() - txDate.getTime()) > threeDays) return false;
      return true;
    });
    if (match) {
      results.push({ incoming: tx, matched: match });
    }
  }
  return results;
}

// ── Reconciliation: expected vs actual ──────────────────────────────────

export type ReconciliationResult = {
  matched: { ruleName: string; type: string; dueDate: string; amount: number; matchedAmount: number }[];
  missing: { ruleName: string; type: string; dueDate: string; expectedAmount: number }[];
  unexpected: ParsedTransaction[];
};

/** Compare imported transactions against active recurring rules in a date range. */
export function reconcileTransactions(
  rules: { name: string; type: string; amount: number; category: string; anchorDate: Date; frequency: string }[],
  importedTransactions: ParsedTransaction[],
  dateFrom: string,
  dateTo: string,
): ReconciliationResult {
  const matched: ReconciliationResult['matched'] = [];
  const missing: ReconciliationResult['missing'] = [];
  const unexpected: ReconciliationResult['unexpected'] = [];

  const fromDate = new Date(dateFrom + 'T00:00:00');
  const toDate = new Date(dateTo + 'T00:00:00');

  // For each active rule, find expected due dates in the range
  for (const rule of rules) {
    const dueDates = occurrencesBetween(
      rule.anchorDate,
      rule.frequency as RuleFrequency,
      fromDate,
      toDate,
    );
    for (const dueDate of dueDates) {
      // Local formatting, not toISOString(): occurrence dates are built as
      // local midnight, so UTC conversion reports the previous day for anyone
      // west of Greenwich and the "missing on <date>" line reads a day off.
      const dueStr = ymdOf(dueDate);
      const expectedAbs = rule.amount;

      // Look for a matching imported transaction
      const found = importedTransactions.find((tx) => {
        if (!vendorsSimilar(tx.vendor, rule.name)) return false;
        const txAbs = Math.abs(tx.amount);
        if (Math.abs(txAbs - expectedAbs) / expectedAbs > 0.3) return false; // >30% difference
        const txDate = new Date(tx.date + 'T00:00:00');
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        if (Math.abs(txDate.getTime() - dueDate.getTime()) > threeDays) return false;
        return true;
      });

      if (found) {
        matched.push({
          ruleName: rule.name,
          type: rule.type,
          dueDate: dueStr,
          amount: rule.type === 'income' ? rule.amount : -rule.amount,
          matchedAmount: found.amount,
        });
      } else {
        missing.push({
          ruleName: rule.name,
          type: rule.type,
          dueDate: dueStr,
          expectedAmount: rule.type === 'income' ? rule.amount : -rule.amount,
        });
      }
    }
  }

  // Flag imported transactions that don't match any rule as unexpected
  const matchedVendorAmounts = new Set(
    matched.map((m) => `${m.ruleName}|${Math.abs(m.amount)}`),
  );
  for (const tx of importedTransactions) {
    const isExpected = rules.some((r) => {
      const amtMatch = Math.abs(Math.abs(tx.amount) - r.amount) / r.amount <= 0.3;
      return amtMatch && vendorsSimilar(tx.vendor, r.name);
    });
    if (!isExpected) {
      unexpected.push(tx);
    }
  }

  return { matched, missing, unexpected };
}

// ── Variance tracking ───────────────────────────────────────────────────

export type RuleVariance = {
  averageAmount: number;
  minAmount: number;
  maxAmount: number;
  averageVariance: number;
  variancePercent: number;
  suggestedAmount: number;
  sampleCount: number;
};

/** Compare a recurring rule's expected amount against actual matched transactions. */
export function computeRuleVariance(
  ruleAmount: number,
  matchedTransactions: ParsedTransaction[],
): RuleVariance {
  if (matchedTransactions.length === 0) {
    return {
      averageAmount: ruleAmount,
      minAmount: ruleAmount,
      maxAmount: ruleAmount,
      averageVariance: 0,
      variancePercent: 0,
      suggestedAmount: ruleAmount,
      sampleCount: 0,
    };
  }

  const actuals = matchedTransactions.map((t) => Math.abs(t.amount));
  const avg = actuals.reduce((s, a) => s + a, 0) / actuals.length;
  const diff = avg - ruleAmount;
  const pct = ruleAmount > 0 ? (diff / ruleAmount) * 100 : 0;

  return {
    averageAmount: Math.round(avg * 100) / 100,
    minAmount: Math.round(Math.min(...actuals) * 100) / 100,
    maxAmount: Math.round(Math.max(...actuals) * 100) / 100,
    averageVariance: Math.round(diff * 100) / 100,
    variancePercent: Math.round(pct * 10) / 10,
    suggestedAmount: Math.round(avg * 100) / 100,
    sampleCount: matchedTransactions.length,
  };
}

// ── Pattern auto-detection ──────────────────────────────────────────────

export type PatternSuggestion = {
  vendor: string;
  frequency: RuleFrequency;
  confidence: number; // 0-1
  averageAmount: number;
  category: string;
  occurrences: number;
  type: 'income' | 'expense';
};

/** Analyze transaction history to detect recurring patterns. Checks for
 *  consistent intervals matching known frequencies. */
export function detectRecurringPatterns(
  transactions: { vendor: string; amount: number; date: string; category: string }[],
  existingRules: { name: string }[],
): PatternSuggestion[] {
  const existingNames = new Set(existingRules.map((r) => r.name.toLowerCase().trim()));
  const suggestions: PatternSuggestion[] = [];

  // Group by vendor
  const byVendor = new Map<string, { vendor: string; amount: number; date: string; category: string }[]>();
  for (const tx of transactions) {
    const key = tx.vendor.trim().toLowerCase();
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(tx);
  }

  for (const [vendor, txs] of byVendor.entries()) {
    // Skip if already a recurring rule
    if (existingNames.has(vendor)) continue;

    // Need at least 3 occurrences for a reliable pattern
    if (txs.length < 3) continue;

    // Sort by date
    txs.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate intervals between consecutive dates
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      const d1 = new Date(txs[i - 1].date + 'T00:00:00');
      const d2 = new Date(txs[i].date + 'T00:00:00');
      intervals.push(Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
    }

    if (intervals.length < 2) continue;

    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;

    // Determine which frequency matches best and compute confidence
    const frequencies: { freq: RuleFrequency; target: number; tolerance: number }[] = [
      { freq: 'weekly', target: 7, tolerance: 2 },
      { freq: 'biweekly', target: 14, tolerance: 3 },
      { freq: 'semimonthly', target: 15, tolerance: 3 },
      { freq: 'monthly', target: 30, tolerance: 4 },
    ];

    let bestFreq: RuleFrequency | null = null;
    let bestConfidence = 0;
    let bestDistance = Infinity;

    for (const { freq, target, tolerance } of frequencies) {
      const withinTolerance = intervals.filter((i) => Math.abs(i - target) <= tolerance);
      const ratio = withinTolerance.length / intervals.length;
      if (ratio < 0.5) continue;
      // Bonus for exact matches
      const exactBonus = withinTolerance.filter((i) => i === target).length / intervals.length * 0.2;
      const confidence = Math.min(1, ratio + exactBonus);
      // Confidence saturates at 1, so biweekly (14) and semimonthly (15) both
      // score 1 on a 1st-and-15th schedule. Break the tie on whichever target
      // the actual average interval sits closest to.
      const distance = Math.abs(avgInterval - target);

      if (confidence > bestConfidence || (confidence === bestConfidence && distance < bestDistance)) {
        bestConfidence = confidence;
        bestDistance = distance;
        bestFreq = freq;
      }
    }

    if (!bestFreq || bestConfidence < 0.4) continue;

    const amounts = txs.map((t) => Math.abs(t.amount));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    // Direction has to come from the RAW signed amounts. Deriving it from
    // `amounts` (already absolute) made every suggestion look like income.
    const isIncome = txs.filter((t) => t.amount > 0).length >= txs.length / 2;

    suggestions.push({
      vendor: txs[0].vendor, // original casing
      frequency: bestFreq,
      confidence: Math.round(bestConfidence * 100) / 100,
      averageAmount: Math.round(avgAmount * 100) / 100,
      category: txs[0].category,
      occurrences: txs.length,
      type: isIncome ? 'income' : 'expense',
    });
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

// ── Display month resolution ─────────────────────────────────────────────

/** Pick the month the dashboard should show. An explicit `YYYY-MM` wins;
 *  malformed values are ignored. Otherwise show the current month, unless it
 *  has no transactions at all, in which case fall back to the most recent
 *  month that does so a dashboard fed by older statements isn't blank.
 *  `end` is exclusive (the first instant of the following month). */
export function resolveDisplayMonth(
  requestedMonth: string | null | undefined,
  txDates: string[],
  now: Date,
): { start: Date; end: Date } {
  const monthOf = (y: number, m: number) => ({
    start: new Date(y, m, 1),
    end: new Date(y, m + 1, 1),
  });

  if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
    const [y, m] = requestedMonth.split('-').map(Number);
    return monthOf(y, m - 1);
  }

  const currentPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (txDates.some((d) => d.startsWith(currentPrefix))) return monthOf(now.getFullYear(), now.getMonth());

  let latest: string | null = null;
  for (const d of txDates) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (latest === null || d > latest)) latest = d;
  }
  if (latest) {
    const [y, m] = latest.split('-').map(Number);
    return monthOf(y, m - 1);
  }
  return monthOf(now.getFullYear(), now.getMonth());
}

// ── Category budgets (Type=Budget envelope rows) ─────────────────────────

// How many times a period occurs in a year. Mirrors the table used by
// `normalizeBudgetAmount` in DatabaseView so the dashboard and the
// budget-summary view read the same envelope rows the same way.
const BUDGET_PERIOD_ANNUAL_FACTOR: Record<string, number> = {
  'Weekly': 52,
  'Bi-Weekly': 26,
  'Biweekly': 26,
  'Semi-Monthly': 24,
  'Monthly': 12,
  'Quarterly': 4,
  'Annual': 1,
  'Yearly': 1,
};

/** Convert a budget amount stated for `fromPeriod` into a monthly figure.
 *  One-Time, blank, or unrecognized periods pass through unchanged. */
export function normalizeBudgetToMonthly(amount: number, fromPeriod: string): number {
  const factor = BUDGET_PERIOD_ANNUAL_FACTOR[fromPeriod.trim()];
  if (!factor) return amount;
  return (amount * factor) / 12;
}

/** Inverse of `normalizeBudgetToMonthly` — express a monthly figure in
 *  `toPeriod` so an existing envelope row keeps the period the user chose. */
export function denormalizeMonthlyBudget(monthlyAmount: number, toPeriod: string): number {
  const factor = BUDGET_PERIOD_ANNUAL_FACTOR[toPeriod.trim()];
  if (!factor) return monthlyAmount;
  return (monthlyAmount * 12) / factor;
}

/** Share of the display month that has already passed, 0-100. Months entirely
 *  in the past return 100, months entirely in the future return 0. `end` is
 *  exclusive (the first instant of the following month). */
export function monthElapsedPercent(start: Date, end: Date, now: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 100;
  const elapsed = now.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= span) return 100;
  return Math.round((elapsed / span) * 1000) / 10;
}

export type CategoryBudget = {
  category: string;
  budgeted: number;          // monthly target, 0 when the category has no envelope
  spent: number;
  remaining: number;         // budgeted - spent (negative = overspent)
  pctSpent: number;          // 0 when there is no budget to spend against
  pctOfMonthElapsed: number;
};

/** Join monthly envelope targets to this month's spend. Categories with a
 *  budget OR spend are included; budgeted categories sort first, by how much
 *  of the envelope is used. */
export function computeCategoryBudgets(
  budgets: { category: string; monthlyAmount: number }[],
  spendByCategory: { category: string; spent: number }[],
  pctOfMonthElapsed: number,
): CategoryBudget[] {
  const budgeted = new Map<string, number>();
  for (const b of budgets) {
    const key = b.category.trim();
    if (!key) continue;
    budgeted.set(key, (budgeted.get(key) ?? 0) + b.monthlyAmount);
  }
  const spent = new Map<string, number>();
  for (const s of spendByCategory) {
    const key = s.category.trim();
    if (!key) continue;
    spent.set(key, (spent.get(key) ?? 0) + s.spent);
  }

  const rows: CategoryBudget[] = [];
  for (const category of new Set([...budgeted.keys(), ...spent.keys()])) {
    const b = Math.round((budgeted.get(category) ?? 0) * 100) / 100;
    const s = Math.round((spent.get(category) ?? 0) * 100) / 100;
    if (b <= 0 && s <= 0) continue;
    rows.push({
      category,
      budgeted: b,
      spent: s,
      remaining: Math.round((b - s) * 100) / 100,
      pctSpent: b > 0 ? Math.round((s / b) * 1000) / 10 : 0,
      pctOfMonthElapsed,
    });
  }

  rows.sort((a, b) => {
    if (a.budgeted > 0 !== b.budgeted > 0) return a.budgeted > 0 ? -1 : 1;
    if (a.budgeted > 0) return b.pctSpent - a.pctSpent;
    return b.spent - a.spent;
  });
  return rows;
}

// ── Statement integrity ──────────────────────────────────────────────────

export type ImportBalanceCheck = {
  importId: string;
  account: string | null;
  openingBalance: number;
  closingBalance: number;
  expectedNet: number;   // what the statement says happened: closing - opening
  actualNet: number;     // what the imported rows actually add up to
  discrepancy: number;   // expected - actual. >0 = money the ledger never saw
  txCount: number;
};

/** Compare each statement's own opening/closing balances against the
 *  transactions that came in with it. The bank's balances are ground truth, so
 *  any difference is a row the extraction missed (or mis-signed, or doubled) —
 *  which is otherwise invisible, since a missing transaction leaves nothing
 *  behind to notice.
 *
 *  Only imports carrying BOTH balances can be checked; the rest are skipped
 *  rather than guessed at. Transactions are attributed by account so two
 *  accounts covering the same dates don't contaminate each other. */
export function checkImportBalances(
  imports: {
    id: string;
    account: string | null;
    openingBalance: number | null;
    closingBalance: number | null;
    dateFrom: Date;
    dateTo: Date;
  }[],
  transactions: { account?: string | null; date: string; amount: number }[],
): ImportBalanceCheck[] {
  const out: ImportBalanceCheck[] = [];

  for (const imp of imports) {
    if (imp.openingBalance == null || imp.closingBalance == null) continue;
    if (!Number.isFinite(imp.openingBalance) || !Number.isFinite(imp.closingBalance)) continue;

    const from = ymdOf(imp.dateFrom);
    const to = ymdOf(imp.dateTo);
    const wantAccount = (imp.account ?? '').trim();

    const matched = transactions.filter((t) => {
      const acct = (t.account ?? '').trim();
      // An import that named an account only owns that account's rows; one that
      // didn't can only claim rows that aren't attributed elsewhere.
      if (wantAccount ? acct !== wantAccount : acct !== '') return false;
      return t.date >= from && t.date <= to;
    });

    const actualNet = Math.round(matched.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const expectedNet = Math.round((imp.closingBalance - imp.openingBalance) * 100) / 100;

    out.push({
      importId: imp.id,
      account: wantAccount || null,
      openingBalance: imp.openingBalance,
      closingBalance: imp.closingBalance,
      expectedNet,
      actualNet,
      discrepancy: Math.round((expectedNet - actualNet) * 100) / 100,
      txCount: matched.length,
    });
  }
  return out;
}

// ── Account balances ─────────────────────────────────────────────────────

/** Bucket for transactions whose account we don't know. Never carries a
 *  balance claim — we have no statement to anchor it to. */
export const UNASSIGNED_ACCOUNT = 'Unassigned';

export type AccountBalance = {
  account: string;
  balance: number | null;   // null = no statement closing balance to anchor on
  asOf: string | null;      // dateTo of the statement the balance came from
  statementBalance: number | null;
  sinceStatement: number;   // signed sum of transactions dated after asOf
  txCount: number;          // transactions attributed to this account
};

const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Pure core of `computeAccountBalances`. For each account, anchor on the most
 *  recent statement that stated a closing balance and roll forward every
 *  transaction dated strictly after that statement's end date. Accounts with no
 *  such statement are listed with a null balance rather than a guess. */
export function computeAccountBalancesFrom(
  imports: { account: string | null; closingBalance: number | null; dateTo: Date }[],
  transactions: { account?: string | null; date: string; amount: number }[],
): AccountBalance[] {
  // Latest anchoring statement per account
  const anchors = new Map<string, { closingBalance: number; dateTo: string }>();
  for (const imp of imports) {
    const account = (imp.account ?? '').trim();
    if (!account) continue;
    if (imp.closingBalance == null || !Number.isFinite(imp.closingBalance)) continue;
    const dateTo = ymdOf(imp.dateTo);
    const current = anchors.get(account);
    if (!current || dateTo >= current.dateTo) {
      anchors.set(account, { closingBalance: imp.closingBalance, dateTo });
    }
  }

  const since = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const tx of transactions) {
    const account = (tx.account ?? '').trim() || UNASSIGNED_ACCOUNT;
    counts.set(account, (counts.get(account) ?? 0) + 1);
    const anchor = anchors.get(account);
    if (anchor && tx.date > anchor.dateTo) {
      since.set(account, (since.get(account) ?? 0) + tx.amount);
    }
  }

  const rows: AccountBalance[] = [];
  for (const account of new Set([...anchors.keys(), ...counts.keys()])) {
    const anchor = anchors.get(account);
    const sinceStatement = Math.round((since.get(account) ?? 0) * 100) / 100;
    rows.push({
      account,
      balance: anchor ? Math.round((anchor.closingBalance + sinceStatement) * 100) / 100 : null,
      asOf: anchor?.dateTo ?? null,
      statementBalance: anchor?.closingBalance ?? null,
      sinceStatement,
      txCount: counts.get(account) ?? 0,
    });
  }

  // Accounts with a real balance first (largest first), then unanchored ones,
  // with the catch-all bucket always last.
  rows.sort((a, b) => {
    if (a.account === UNASSIGNED_ACCOUNT) return 1;
    if (b.account === UNASSIGNED_ACCOUNT) return -1;
    if ((a.balance == null) !== (b.balance == null)) return a.balance == null ? 1 : -1;
    if (a.balance != null && b.balance != null) return b.balance - a.balance;
    return a.account.localeCompare(b.account);
  });
  return rows;
}

/** Roll a starting balance forward through scheduled occurrences, one point
 *  per day, starting today. Returns the curve and the first day it dips below
 *  zero (null if it never does). */
export function buildBalanceCurve(
  startingBalance: number,
  forecast: { date: string; amount: number }[],
  days: number,
  today: Date,
): { curve: { date: string; balance: number }[]; negativeOn: string | null } {
  const byDate = new Map<string, number>();
  for (const f of forecast) byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount);

  const curve: { date: string; balance: number }[] = [];
  let negativeOn: string | null = null;
  let running = startingBalance;
  for (let i = 0; i <= days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const date = ymdOf(d);
    running += byDate.get(date) ?? 0;
    if (running < 0 && !negativeOn) negativeOn = date;
    curve.push({ date, balance: Math.round(running * 100) / 100 });
  }
  return { curve, negativeOn };
}

// ── Coverage gap computation ─────────────────────────────────────────────

export type CoverageGap = { from: string; to: string; days: number };

/** Given an array of [dateFrom, dateTo] pairs (chronologically sorted),
 *  return gaps > minGapDays between consecutive ranges. */
export function computeCoverageGaps(
  ranges: { dateFrom: Date; dateTo: Date }[],
  minGapDays: number = 3,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  if (ranges.length < 2) return gaps;
  const sorted = [...ranges].sort((a, b) => a.dateFrom.getTime() - b.dateFrom.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].dateTo;
    const currStart = sorted[i].dateFrom;
    const gapMs = currStart.getTime() - prevEnd.getTime();
    const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24)) - 1;
    if (gapDays > minGapDays) {
      gaps.push({
        from: new Date(prevEnd.getTime() + 86400000).toISOString().slice(0, 10),
        to: new Date(currStart.getTime() - 86400000).toISOString().slice(0, 10),
        days: gapDays,
      });
    }
  }
  return gaps;
}
