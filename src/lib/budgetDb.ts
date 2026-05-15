import { prisma } from './prisma';
import { DB_TEMPLATES } from './dbTemplates';

// The Personal Budget feature works against the user's "Personal Budget"
// database (built from the template). This module finds or creates it.

export type BudgetDb = {
  id: string;
  name: string;
  properties: { id: string; name: string; type: string }[];
};

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
    return {
      id: existing.id,
      name: existing.name,
      properties: existing.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
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
    properties: created!.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
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

// Process every active rule for a user — generate any past-due transactions
// up through today, advance the anchor, and update lastGeneratedDate.
export async function runRecurringEngine(userId: string, today: Date = new Date()): Promise<{
  generated: number;
}> {
  const rules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true },
  });
  if (rules.length === 0) return { generated: 0 };

  const db = await findOrCreateBudgetDb(userId);

  let generated = 0;
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
        description: `Recurring ${rule.type}: ${rule.name}`,
        amount: signed,
        category: rule.category,
      };
    });
    await writeTransactions(userId, db.id, transactions);
    generated += transactions.length;

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

  return { generated };
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
};

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
      { propertyId: propId['Vendor'],   value: tx.vendor },
      { propertyId: propId['Status'],   value: 'Cleared' },
    ];
    if (propId['Notes'] && tx.description !== tx.vendor) {
      writes.push({ propertyId: propId['Notes'], value: tx.description });
    }
    await prisma.propertyValue.createMany({
      data: writes.map((w) => ({ ...w, pageId: page.id })),
    });
    created++;
  }
  return { created };
}
