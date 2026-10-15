// A journal to-do has no id of its own, so its thread is keyed by its text.
// Case, spacing and a trailing period do not make it a different to-do.
export function todoKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;:,]+$/, '').slice(0, 300);
}
