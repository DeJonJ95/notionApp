/** Blanks the assistant left for facts it did not have, e.g. [[account number]]. */
export function fillIns(...parts: string[]): string[] {
  const found = parts.join('\n').match(/\[\[([^\]\n]{1,60})\]\]/g) ?? [];
  return Array.from(new Set(found.map((f) => f.slice(2, -2).trim())));
}
