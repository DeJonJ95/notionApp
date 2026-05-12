import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Fractional indexing for reorderable lists
export function getPositionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1024;
  if (prev === null) return next! / 2;
  if (next === null) return prev + 1024;
  return (prev + next) / 2;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function evaluateFormula(formula: string, values: Record<string, any>) {
  if (!formula || typeof formula !== 'string') return '';

  const keys = Object.keys(values).sort((a, b) => b.length - a.length);
  let expression = formula;

  for (const key of keys) {
    const safeKey = `values["${key.replace(/"/g, '\\"')}"]`;
    expression = expression.replace(new RegExp(escapeRegExp(key), 'g'), safeKey);
  }

  if (!/^[0-9a-zA-Z_"\[\]\.\s\+\-\*\/\%\(\),]+$/.test(expression)) {
    throw new Error('Invalid formula syntax');
  }

  // eslint-disable-next-line no-new-func
  return Function('values', `return (${expression})`)(values);
}

export function computeFormulaValues(
  properties: { id: string; name: string; formula?: string }[],
  values: Record<string, any>
) {
  return properties.reduce<Record<string, any>>((result, prop) => {
    if (prop.formula) {
      try {
        result[prop.id] = evaluateFormula(prop.formula, values);
      } catch (error) {
        result[prop.id] = `Formula error`;
      }
    }
    return result;
  }, {});
}

export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}
