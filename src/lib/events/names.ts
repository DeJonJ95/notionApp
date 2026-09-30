export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'+]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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

export function firstToken(name: string): string {
  return normalizeName(name).split(' ')[0] ?? '';
}
