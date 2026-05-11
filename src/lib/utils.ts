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

export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}
