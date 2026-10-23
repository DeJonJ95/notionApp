// Feature gates for owner-only functionality (costly external APIs that
// haven't been opened to all users yet — mood board search, YouTube
// transcript import). Owner identity comes from a single env var so it's
// easy to change without a deploy code change.

import type { Session } from 'next-auth';

const ownerEmail = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase();

// Sign-in allowlist: OWNER_EMAIL plus comma-separated ALLOWED_EMAILS. Both unset = nobody can sign in.
const allowedEmails = new Set(
  [ownerEmail, ...(process.env.ALLOWED_EMAILS ?? '').split(',')].map((e) => e.trim().toLowerCase()).filter(Boolean),
);

export function isAllowedEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && allowedEmails.has(normalized);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!ownerEmail) return false; // unconfigured = nobody is owner; never accidentally open the gate
  const normalized = email?.trim().toLowerCase();
  return !!normalized && normalized === ownerEmail;
}

/** True if there's an OWNER_EMAIL set and it matches the session's email. */
export function isOwner(session: Session | null | undefined): boolean {
  return isOwnerEmail(session?.user?.email);
}
