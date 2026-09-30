import { normalizeContact } from './names';

export const DEFAULT_INVITE = 'Hey {first}! {event} is {date}. RSVP here: {link}';

type Vars = { name: string; event: string; date: string; link: string };

export function fillMessage(template: string, v: Vars): string {
  const first = v.name.trim().split(/\s+/)[0] ?? '';
  return template
    .replace(/\{first\}/g, first)
    .replace(/\{name\}/g, v.name.trim())
    .replace(/\{event\}/g, v.event)
    .replace(/\{date\}/g, v.date)
    .replace(/\{link\}/g, v.link)
    .trim();
}

export type ContactLink = { kind: 'sms' | 'instagram'; href: string };

/** A phone number opens Messages with the text filled in; a handle opens an
 *  Instagram DM, which can't be pre-filled, so the caller copies the text. */
export function contactLink(contact: string | null | undefined, body: string): ContactLink | null {
  if (!contact?.trim()) return null;
  const c = normalizeContact(contact);
  if (/^\d{10}$/.test(c)) return { kind: 'sms', href: `sms:+1${c}?&body=${encodeURIComponent(body)}` };
  if (/^[a-z0-9._]{1,30}$/.test(c)) return { kind: 'instagram', href: `https://ig.me/m/${c}` };
  return null;
}
