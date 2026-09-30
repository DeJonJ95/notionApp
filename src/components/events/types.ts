export type EventSummary = {
  id: string;
  name: string;
  date: string;
  venue: string | null;
  guests: number;
  going: number;
  attended: number;
};

export type Guest = {
  id: string;
  source: string | null;
  rsvp: string | null;
  attended: boolean;
  checkedInAt: string | null;
  invitedBy: string | null;
  cameBefore: number;
  missedBefore: number;
  maybeSame: { id: string; name: string }[];
  invitedAt: string | null;
  person: { id: string; name: string; contact: string | null; isPlaceholder: boolean };
  guestOf: { id: string; name: string } | null;
};

export type EventDetailData = {
  id: string;
  name: string;
  date: string;
  venue: string | null;
  link: string | null;
  checkInToken: string;
  checkInOpen: boolean;
  inviteMessage: string | null;
  attendances: Guest[];
};

export const RSVP_LABELS: Record<string, string> = {
  going: 'Going',
  maybe: 'Maybe',
  'cant-go': "Can't go",
  invited: 'Invited',
};

export const SOURCE_LABELS: Record<string, string> = {
  partiful: 'Partiful',
  text: 'Text',
  dm: 'DM',
  'walk-in': 'Walk-in',
  qr: 'QR check-in',
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}
