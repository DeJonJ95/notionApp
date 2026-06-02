import { z } from 'zod';

// Application lifecycle. The first block is the linear "pipeline" used for
// progress ordering; the terminal block is reachable from anywhere. Free
// movement is allowed between any states — ordering is only used for UI
// sorting and the funnel summary, not to constrain transitions.
export const PIPELINE_STATUSES = [
  'SAVED',
  'APPLIED',
  'SCREEN',
  'INTERVIEW',
  'ONSITE',
  'OFFER',
  'ACCEPTED',
] as const;

export const TERMINAL_STATUSES = ['REJECTED', 'GHOSTED', 'WITHDRAWN'] as const;

export const ALL_STATUSES = [...PIPELINE_STATUSES, ...TERMINAL_STATUSES] as const;

export type AppStatus = (typeof ALL_STATUSES)[number];

export const statusSchema = z.enum(ALL_STATUSES);

export const STATUS_LABELS: Record<AppStatus, string> = {
  SAVED: 'Saved',
  APPLIED: 'Applied',
  SCREEN: 'Phone screen',
  INTERVIEW: 'Interview',
  ONSITE: 'Onsite / final',
  OFFER: 'Offer',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  GHOSTED: 'Ghosted',
  WITHDRAWN: 'Withdrawn',
};

// Tailwind class fragments for the status chip. Kept here so the chip looks
// the same everywhere it's rendered.
export const STATUS_COLORS: Record<AppStatus, string> = {
  SAVED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  APPLIED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SCREEN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  INTERVIEW: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  ONSITE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  OFFER: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  ACCEPTED: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  GHOSTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  WITHDRAWN: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as AppStatus] ?? status;
}

// "Active" = still in play. Used for the funnel summary and to decide
// whether a row counts as an open application.
export function isActive(status: string): boolean {
  return (PIPELINE_STATUSES as readonly string[]).includes(status) && status !== 'ACCEPTED';
}
