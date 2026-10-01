export function normalizeName(name: string): string {
  const plain = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'+]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  // An emoji-only name has nothing left once symbols go; keep it as typed so
  // it still matches itself on the next import.
  return plain || name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeContact(contact: string): string {
  const c = contact.trim().toLowerCase();
  const digits = c.replace(/\D/g, '');
  if (digits.length >= 10 && /^[\d\s()+.-]+$/.test(c)) return digits.slice(-10);
  return c.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').replace(/\/$/, '');
}

const PLUS_ONE = /^(.+?)[’']s \+\s?1$/i;

/** Partiful exports an unnamed guest as "<host>'s +1". */
export function plusOneHost(name: string): string | null {
  const m = name.trim().match(PLUS_ONE);
  return m ? m[1].trim() : null;
}

/** Placeholder keys ("smoke's +1") on the event that a fresh export has
 *  replaced with the guest's real name: a named row now points at that host
 *  and the placeholder itself is gone from the file. */
export function replacedPlusOnes(rows: { name: string; plusOneOf?: string }[], existing: Iterable<string>): string[] {
  const inFile = new Set(rows.map((r) => normalizeName(r.name)));
  const hostsWithNamedGuest = new Set(
    rows.filter((r) => r.plusOneOf && !plusOneHost(r.name)).map((r) => normalizeName(`${r.plusOneOf}'s +1`)),
  );
  return Array.from(existing).filter((key) => hostsWithNamedGuest.has(key) && !inFile.has(key));
}

export function firstToken(name: string): string {
  return normalizeName(name).split(' ')[0] ?? '';
}
