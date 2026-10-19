import type { Tx } from '@/lib/budgetLedger';

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

const round2 = (n: number) => Math.round(n * 100) / 100;
const NOT_SUBSCRIPTIONS = ['Food & Dining', 'Transport'];

function expensesByVendor(rows: Tx[], now: Date): Map<string, Tx[]> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const byVendor = new Map<string, Tx[]>();
  for (const t of rows) {
    if (!(t.amount < 0 && new Date(t.date) >= cutoff)) continue;
    const key = t.vendor.trim();
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(t);
  }
  return byVendor;
}

/** Subscriptions: a vendor with 2+ expense charges in the trailing 90 days at a
 *  similar amount (within 15% of the mean). Repeat vendors: every other vendor
 *  charged 2+ times, so the user can flag what the strict heuristic missed
 *  (food, transport, variable utilities, car payments). */
export function detectRepeatVendors(rows: Tx[], now: Date): { subscriptions: Subscription[]; repeatVendors: RepeatVendor[] } {
  const subscriptions: Subscription[] = [];
  const repeated: RepeatVendor[] = [];
  for (const [vendor, txs] of expensesByVendor(rows, now)) {
    if (txs.length < 2) continue;
    const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const mean = total / txs.length;
    const similarCount = txs.filter((t) => Math.abs(Math.abs(t.amount) - mean) / mean < 0.15).length;
    const isSubscription = similarCount >= 2 && !NOT_SUBSCRIPTIONS.includes(txs[0].category);
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const occurrences = txs.length;
    const averageAmount = round2(mean);
    const lastDate = txs.at(-1)!.date;
    const category = txs[0].category;
    repeated.push({ vendor, occurrences, totalAmount: round2(total), averageAmount, lastDate, category });
    if (isSubscription) {
      subscriptions.push({ vendor, averageAmount, occurrences, lastDate, category, monthlyEstimate: averageAmount });
    }
  }
  subscriptions.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
  const subVendorSet = new Set(subscriptions.map((s) => s.vendor.toLowerCase()));
  const repeatVendors = repeated.filter((v) => !subVendorSet.has(v.vendor.toLowerCase()));
  repeatVendors.sort((a, b) => b.totalAmount - a.totalAmount);
  return { subscriptions, repeatVendors };
}
