// The single copy of the budget category list, plus the parser for a user's
// own options. Deliberately free of server-only imports (no prisma) so client
// components can import DEFAULT_CATEGORIES too.

/** Fallback list, used when a budget database has no readable Category
 *  options. Matches the `personal-budget` template in `dbTemplates.ts`. */
export const DEFAULT_CATEGORIES = [
  'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
  'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
  'Subscriptions', 'Investments', 'Debt', 'Gifts & Donations',
  'Emergency Fund', 'Other',
];

/** Read a select property's options out of `Property.formula`, which holds a
 *  JSON array for `type='select'` (gotcha 21). Any malformed value falls back
 *  to DEFAULT_CATEGORIES rather than leaving the caller with nothing. */
export function parseCategoryOptions(formula: string | null | undefined): string[] {
  if (!formula) return DEFAULT_CATEGORIES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(formula);
  } catch {
    return DEFAULT_CATEGORIES;
  }
  if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES;
  const options = parsed
    .map((o) => String(o ?? '').trim())
    .filter((o) => o.length > 0);
  return options.length > 0 ? options : DEFAULT_CATEGORIES;
}

/** The category to fall back to when a value isn't one of `categories`.
 *  Prefers 'Other', but a user who removed it still gets a valid option. */
export function fallbackCategory(categories: string[]): string {
  return categories.includes('Other') ? 'Other' : (categories[0] ?? 'Other');
}
