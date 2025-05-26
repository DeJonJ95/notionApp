// Feature gates for owner-only functionality (costly external APIs that
// haven't been opened to all users yet — mood board search, YouTube
// transcript import). Owner identity comes from a single env var so it's
// easy to change without a deploy code change.

import type { Session } from 'next-auth';

const ownerEmail = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase();

/** True if there's an OWNER_EMAIL set and it matches the session's email. */
export function isOwner(session: Session | null | undefined): boolean {
  if (!ownerEmail) return false; // unconfigured = nobody is owner; never accidentally open the gate
  const email = session?.user?.email?.trim().toLowerCase();
  return !!email && email === ownerEmail;
}
