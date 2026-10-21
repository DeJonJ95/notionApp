import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

// Each tool maps 1:1 to a SQL function in prisma/sql/budget-metrics.sql. The
// user and database ids come from the session, never from the model's arguments.

export type ToolContext = { userId: string; databaseId: string };
export type Row = Record<string, string | number | boolean | null>;

const MAX_SPAN_DAYS = 731;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().startsWith(d), 'Not a real date');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Months are YYYY-MM');
const DATES = { start_date: isoDate, end_date: isoDate };

const datesInOrder = <T extends { start_date: string; end_date: string }>(schema: z.ZodType<T>) =>
  schema.refine((a) => a.start_date <= a.end_date, 'start_date must not be after end_date');
const dateRange = datesInOrder(z.object(DATES).strict())
  .refine((a) => (Date.parse(a.end_date) - Date.parse(a.start_date)) / 86_400_000 <= MAX_SPAN_DAYS, 'Ranges are limited to two years');

const DATE_PROPS = {
  start_date: { type: 'string', description: 'First day, YYYY-MM-DD, inclusive' },
  end_date: { type: 'string', description: 'Last day, YYYY-MM-DD, inclusive' },
};

const allRequired = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

type Spec = {
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType<Record<string, unknown>>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown[]>;
};

const sql = (strings: TemplateStringsArray, ...values: unknown[]) => prisma.$queryRaw<unknown[]>(Prisma.sql(strings, ...values));

const FIXED_SPECS: Record<string, Spec> = {
  spend_by_category: {
    description: 'Spend per category between two dates, plus an "All categories" total row. Spend is posted outflows; transfers, card payments and forecasts are excluded; refunds net against their category.',
    parameters: allRequired(DATE_PROPS),
    schema: dateRange,
    run: (a, c) => sql`SELECT * FROM spend_by_category(${c.userId}, ${c.databaseId}, ${a.start_date}::date, ${a.end_date}::date)`,
  },
  month_over_month: {
    description: 'For the N most recent closed months, each category\'s spend against the month before, with $ and % change and an "All categories" row per month. notable is true when a change is at least $25 and at least 15%. Rows are ranked by absolute $ change.',
    parameters: allRequired({
      months: { type: 'integer', minimum: 1, maximum: 12, description: 'How many closed months' },
      include_current_month: { type: 'boolean', description: 'Also include the current partial month' },
    }),
    schema: z.object({ months: z.number().int().min(1).max(12), include_current_month: z.boolean() }).strict(),
    run: (a, c) => sql`SELECT * FROM month_over_month(${c.userId}, ${c.databaseId}, ${a.months}::int, ${a.include_current_month}::boolean)`,
  },
  budget_variance: {
    description: 'Planned (monthly budget) against actual spend per category for one month, with remaining and over/under, plus totals.',
    parameters: allRequired({ month: { type: 'string', description: 'YYYY-MM' } }),
    schema: z.object({ month }).strict(),
    run: (a, c) => sql`SELECT * FROM budget_variance(${c.userId}, ${c.databaseId}, ${`${a.month}-01`}::date)`,
  },
  month_to_date_pace: {
    description: 'Spend so far in a month against a straight-line pace through its budget (planned x days elapsed / days in month), with a projected month-end figure. Days elapsed stop at data_through, the last day imported statements reach; say so when it is before today.',
    parameters: allRequired({ month: { type: 'string', description: 'YYYY-MM, usually the current month' } }),
    schema: z.object({ month }).strict(),
    run: (a, c) => sql`SELECT * FROM month_to_date_pace(${c.userId}, ${c.databaseId}, ${`${a.month}-01`}::date)`,
  },
  bill_payment_status: {
    description: 'Each recurring bill due between two dates (and not in the future): due date, paid date and amount, status (on_time, late, missed, not_confirmed) and days late.',
    parameters: allRequired(DATE_PROPS),
    schema: dateRange,
    run: (a, c) => sql`SELECT * FROM bill_payment_status(${c.userId}, ${c.databaseId}, ${a.start_date}::date, ${a.end_date}::date)`,
  },
  top_transactions: {
    description: 'The largest purchases between two dates, optionally within one category.',
    parameters: allRequired({
      ...DATE_PROPS,
      category: { type: ['string', 'null'], description: 'Exact category name, or null for all' },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    }),
    schema: datesInOrder(z.object({
      ...DATES, category: z.string().trim().min(1).max(60).nullable(), limit: z.number().int().min(1).max(25),
    }).strict()),
    run: (a, c) => sql`SELECT * FROM top_transactions(${c.userId}, ${c.databaseId}, ${a.start_date}::date, ${a.end_date}::date, ${a.category}, ${a.limit}::int)`,
  },
};

// The group enum is the user's own merchant groups, so it is built per request.
function specs(groups: string[]): Record<string, Spec> {
  const groupEnum = groups.length > 0 ? groups : ['fast_food'];
  return {
    ...FIXED_SPECS,
    spend_by_merchant_group: {
      description: 'Spend at a merchant group between two dates: a "total" row, one "month" row per month, and the "transaction" rows that make it up.',
      parameters: allRequired({ group: { type: 'string', enum: groupEnum }, ...DATE_PROPS }),
      schema: datesInOrder(z.object({ group: z.enum(groupEnum as [string, ...string[]]), ...DATES }).strict()),
      run: (a, c) => sql`SELECT * FROM spend_by_merchant_group(${c.userId}, ${c.databaseId}, ${a.group}, ${a.start_date}::date, ${a.end_date}::date)`,
    },
  };
}

/** Tool definitions in the OpenAI format DeepSeek accepts. */
export function toolDefinitions(groups: string[]) {
  return Object.entries(specs(groups)).map(([name, s]) => ({
    type: 'function' as const,
    function: { name, description: s.description, parameters: s.parameters },
  }));
}

const cell = (v: unknown): Row[string] => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'bigint') return Number(v);
  return (v ?? null) as Row[string];
};

export type ToolOutcome = { args: Record<string, unknown>; rows: Row[]; error?: string };

export async function runTool(name: string, rawArgs: string, groups: string[], ctx: ToolContext): Promise<ToolOutcome> {
  const all = specs(groups);
  // The name comes from the model, so "toString" must not resolve to an inherited property.
  const spec = Object.hasOwn(all, name) ? all[name] : undefined;
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { args: {}, rows: [], error: 'Arguments were not valid JSON' };
  }
  if (!spec) return { args: {}, rows: [], error: `Unknown tool ${name}` };
  const parsed = spec.schema.safeParse(args);
  if (!parsed.success) {
    return { args: (args ?? {}) as Record<string, unknown>, rows: [], error: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  }
  try {
    const rows = await spec.run(parsed.data, ctx);
    return { args: parsed.data, rows: rows.map((r) => Object.fromEntries(Object.entries(r as object).map(([k, v]) => [k, cell(v)]))) };
  } catch (e) {
    console.error(`budget tool ${name} failed:`, e);
    return { args: parsed.data, rows: [], error: 'The query failed' };
  }
}
