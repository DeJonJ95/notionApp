import { normalizeContact, normalizeName } from './names';

export type Findable = { id: string; name: string; aliases?: string[]; contact: string | null };

/** Edits between two strings, counting a swapped adjacent pair ("kyel") as one. */
export function editDistance(a: string, b: string): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
    }
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** How well one known spelling fits what's typed, 0 = not at all. Typos are
 *  forgiven in proportion to length so "mikael" finds "Michael". */
function nameScore(q: string, n: string): number {
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  const words = n.split(' ');
  const typed = q.split(' ');
  if (words.some((w) => w.startsWith(q))) return 80;
  if (typed.every((t) => words.some((w) => w.startsWith(t)))) return 75;
  if (n.includes(q)) return 70;
  const slack = Math.max(1, Math.round(q.length / 3));
  const closest = Math.min(editDistance(q, n), ...words.map((w) => editDistance(q, w)));
  return q.length >= 3 && closest <= slack ? 60 - closest * 5 : 0;
}

function contactScore(query: string, contact: string | null): number {
  const q = normalizeContact(query);
  if (!contact || q.length < 4) return 0;
  return normalizeContact(contact).includes(q) ? 65 : 0;
}

export function fuzzyPeople<T extends Findable>(query: string, people: T[], limit = 6): T[] {
  const q = normalizeName(query);
  if (!q) return [];
  return people
    .map((p) => ({
      p,
      score: Math.max(contactScore(query, p.contact), ...[p.name, ...(p.aliases ?? [])].map((n) => nameScore(q, normalizeName(n)))),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}
