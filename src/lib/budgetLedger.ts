import { isRecurringGeneratedNote, normalizeBudgetToMonthly } from '@/lib/budgetDb';
import { prisma } from '@/lib/prisma';

export type Tx = {
  pageId: string;
  date: string;
  vendor: string;
  amount: number;       // signed: negative = expense, positive = income
  category: string;
  type: string;
  account: string | null;
  notes: string | null;
  planned: boolean;     // a recurring forecast: says a bill is due, never that it was paid
};

type LedgerPage = {
  id: string;
  title: string | null;
  properties: { value: unknown; property: { name: string } }[];
};

export type Ledger = {
  all: Tx[];
  monthlyBudgets: Map<string, number>;          // Type=Budget envelopes, per month
  savingsRows: { text: string; amount: number }[];  // Type=Savings rows, matched to goals by name
};

/** A row nobody has confirmed: marked Planned, or written by the retired
 *  recurring engine and never set to Cleared by the user. */
export function isForecastRow(vals: Record<string, unknown>): boolean {
  if (vals['Status'] === 'Cleared') return false;
  return vals['Status'] === 'Planned' || isRecurringGeneratedNote(vals['Notes']);
}

const text = (v: unknown, fallback = '') => (v == null ? fallback : String(v));

// Same semantics as the budget-summary view: prefer "Budgeted Amount", fall back to "Amount".
function addEnvelope(budgets: Map<string, number>, vals: Record<string, unknown>) {
  const category = text(vals['Category']).trim();
  const raw = Math.abs(Number(vals['Budgeted Amount'] ?? 0)) || Math.abs(Number(vals['Amount'] ?? 0));
  if (!category || !(raw > 0)) return;
  const monthly = normalizeBudgetToMonthly(raw, text(vals['Budget Period']));
  budgets.set(category, (budgets.get(category) ?? 0) + monthly);
}

export function readLedger(pages: LedgerPage[]): Ledger {
  const ledger: Ledger = { all: [], monthlyBudgets: new Map(), savingsRows: [] };
  for (const p of pages) {
    const vals: Record<string, unknown> = {};
    for (const pv of p.properties) vals[pv.property.name] = pv.value;
    const type = text(vals['Type']);
    if (type === 'Budget') {
      addEnvelope(ledger.monthlyBudgets, vals);
      continue;
    }
    const rawAmt = Number(vals['Amount'] ?? 0);
    if (!rawAmt) continue;
    const vendor = text(vals['Vendor'], p.title ?? '');
    if (type === 'Savings') ledger.savingsRows.push({ text: `${vendor} ${text(vals['Notes'])}`, amount: rawAmt });
    ledger.all.push({
      pageId: p.id,
      date: text(vals['Date']).slice(0, 10),
      vendor,
      amount: type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt),
      category: text(vals['Category'], 'Other'),
      type,
      account: vals['Account'] == null ? null : String(vals['Account']),
      notes: vals['Notes'] == null ? null : String(vals['Notes']),
      planned: isForecastRow(vals),
    });
  }
  return ledger;
}

/** Every live row of a budget database, newest first. The one place routes read
 *  the ledger, so a forecast is never mistaken for money that moved. */
export async function loadLedger(databaseId: string, order: 'asc' | 'desc' = 'desc'): Promise<Ledger> {
  const pages = await prisma.page.findMany({
    where: { databaseId, isArchived: false },
    include: { properties: { include: { property: { select: { name: true } } } } },
    orderBy: { createdAt: order },
  });
  return readLedger(pages);
}

/** Forecast rows the retired recurring engine wrote into the ledger. Bills are
 *  now settled against statements directly, so the first read of a ledger that
 *  still holds them archives them (a soft delete). A row the user set to Cleared
 *  is a confirmed payment and stays. */
export async function archiveLegacyForecasts(rows: Tx[]): Promise<Tx[]> {
  const isLegacy = (t: Tx) => t.planned && isRecurringGeneratedNote(t.notes);
  const legacy = rows.filter(isLegacy).map((t) => t.pageId);
  if (legacy.length > 0) {
    await prisma.page.updateMany({ where: { id: { in: legacy } }, data: { isArchived: true } });
  }
  return rows.filter((t) => !isLegacy(t));
}
