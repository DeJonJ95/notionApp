import { parseImportText } from '@/lib/rowImport';

export type GuestRow = {
  name: string;
  contact?: string;
  source?: string;
  rsvp?: string;
  rsvpAt?: string;
  attended?: boolean;
  invitedBy?: string;
  plusOneOf?: string;
};

const RSVP: Record<string, string> = {
  going: 'going',
  yes: 'going',
  maybe: 'maybe',
  "can't go": 'cant-go',
  'cant go': 'cant-go',
  declined: 'cant-go',
  'not going': 'cant-go',
  "can't make it": 'cant-go',
  no: 'cant-go',
  invited: 'invited',
};

const SOURCES = ['partiful', 'text', 'dm', 'walk-in', 'qr'];

export function toRsvp(raw: string | undefined): string | undefined {
  return raw ? RSVP[raw.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ')] : undefined;
}

export function toSource(raw: string | undefined): string | undefined {
  const s = raw?.trim().toLowerCase().replace(/\s+/g, '-');
  return s && SOURCES.includes(s) ? s : undefined;
}

const pick = (values: Record<string, string>, ...keys: string[]) => {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k);
    if (v) return v;
  }
  return undefined;
};

/** A Partiful guest CSV, any CSV with a Name column, or one name per line
 *  (optionally "name, contact"). `source` fills rows that don't carry one. */
export function parseGuestText(text: string, source?: string): { rows: GuestRow[]; partiful: boolean } {
  const parsed = parseImportText(text, ['Name', 'Contact']);
  const cols = parsed.columns.map((c) => c.toLowerCase());
  const partiful = cols.includes('rsvp date') && cols.includes('is plus one of');
  const rows = parsed.rows.map(({ title, values }) => {
    const attended = pick(values, 'attended', 'came');
    return {
      name: title,
      contact: pick(values, 'contact', 'phone / ig', 'phone', 'instagram', 'ig'),
      source: toSource(pick(values, 'source')) ?? (partiful ? 'partiful' : toSource(source)),
      rsvp: toRsvp(pick(values, 'status', 'rsvp')),
      rsvpAt: pick(values, 'rsvp date'),
      attended: attended === undefined ? undefined : /^(yes|y|true|1|x)$/i.test(attended),
      invitedBy: pick(values, 'invited by'),
      plusOneOf: pick(values, 'is plus one of', 'plus one of'),
    };
  });
  return { rows, partiful };
}
