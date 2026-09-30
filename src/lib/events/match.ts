import { firstToken, normalizeContact, normalizeName } from './names';

export type MatchablePerson = {
  id: string;
  name: string;
  aliases: string[];
  contact: string | null;
  isPlaceholder: boolean;
};

/** Index real people by every spelling they've been seen under. Placeholders
 *  ("X's +1") never match: two events' "X's +1" are rarely the same human. */
export function buildIndex(people: MatchablePerson[]) {
  const byName = new Map<string, string>();
  const byContact = new Map<string, string>();
  for (const p of people) {
    if (p.isPlaceholder) continue;
    for (const n of [p.name, ...p.aliases]) {
      const key = normalizeName(n);
      if (key && !byName.has(key)) byName.set(key, p.id);
    }
    if (p.contact) byContact.set(normalizeContact(p.contact), p.id);
  }
  return {
    find(name: string, contact?: string | null): string | null {
      if (contact) {
        const hit = byContact.get(normalizeContact(contact));
        if (hit) return hit;
      }
      return byName.get(normalizeName(name)) ?? null;
    },
    add(id: string, name: string, contact?: string | null) {
      const key = normalizeName(name);
      if (key && !byName.has(key)) byName.set(key, id);
      if (contact) byContact.set(normalizeContact(contact), id);
    },
  };
}

export type DuplicatePair = { a: string; b: string; reason: string };

/** Pairs worth a human look: same name once spaces are ignored, or a bare
 *  first name ("Briana") alongside a full name that starts with it. */
export function possibleDuplicates(people: MatchablePerson[]): DuplicatePair[] {
  const real = people.filter((p) => !p.isPlaceholder);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const reason = duplicateReason(real[i], real[j]);
      if (reason) pairs.push({ a: real[i].id, b: real[j].id, reason });
    }
  }
  return pairs;
}

function duplicateReason(a: MatchablePerson, b: MatchablePerson): string | null {
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na.replace(/\s/g, '') === nb.replace(/\s/g, '')) return 'Same name';
  if (a.contact && b.contact && normalizeContact(a.contact) === normalizeContact(b.contact)) return 'Same contact';
  const single = !na.includes(' ') || !nb.includes(' ');
  if (single && na.length > 2 && nb.length > 2 && firstToken(na) === firstToken(nb)) return 'Same first name';
  return null;
}
