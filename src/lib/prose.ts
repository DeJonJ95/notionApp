/** House style for generated prose: no em dashes. */
export function plainDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ', ').replace(/,\s*,/g, ',');
}
