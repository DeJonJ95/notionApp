const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export type PropShape = { id: string; type: string; formula?: string | null };

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY);
}

export function shiftDate(value: unknown, days: number): unknown {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || !days) return value;
  const shifted = new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) + days * DAY).toISOString();
  return value.length === 10 ? shifted.slice(0, 10) : `${shifted.slice(0, 10)}${value.slice(10)}`;
}

export function baseTitle(title: string): string {
  return title.replace(/\s+·\s+[^·]+$/, '').trim();
}

function firstOpenOption(prop: PropShape): string | null {
  try {
    const opts: unknown = JSON.parse(prop.formula || '[]');
    if (!Array.isArray(opts)) return null;
    const open = opts.map(String).find((o) => !/^(done|complete|completed|shipped|finished|closed|archived)$/i.test(o));
    return open ?? null;
  } catch {
    return null;
  }
}

export function isStatusProp(prop: PropShape & { name: string }, all: (PropShape & { name: string })[]): boolean {
  if (prop.type !== 'select') return false;
  const named = all.find((p) => p.type === 'select' && /status|stage|state/i.test(p.name));
  return named ? named.id === prop.id : all.find((p) => p.type === 'select')?.id === prop.id;
}

// The value a copied task starts the new cycle with: dates move, progress resets, everything else carries over.
export function nextCycleValue(prop: PropShape, value: unknown, days: number, isStatus: boolean): unknown {
  if (prop.type === 'date') return shiftDate(value, days);
  if (prop.type === 'checkbox') return false;
  if (isStatus) return firstOpenOption(prop);
  return value;
}

export function remapIds<T>(value: T, ids: Map<string, string>): T {
  if (value === null || value === undefined) return value;
  let text = JSON.stringify(value);
  ids.forEach((to, from) => { text = text.split(from).join(to); });
  return JSON.parse(text) as T;
}

export function dateRange(values: unknown[]): { first: string; last: string } | null {
  const dates = values.filter((v): v is string => typeof v === 'string' && ISO_DATE.test(v)).map((v) => v.slice(0, 10)).sort();
  return dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null;
}
