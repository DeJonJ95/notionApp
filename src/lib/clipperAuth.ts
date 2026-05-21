// Bearer-token auth for the browser extension's clipper endpoints.
//
// Why not session cookies: extensions run from chrome-extension://<id>
// origins, which the browser treats as cross-site relative to the app
// domain. NextAuth's default SameSite=Lax cookies are blocked on
// cross-site requests. We'd have to flip to SameSite=None (which has
// real security implications) to fix that. A bearer token avoids the
// entire class of problem and works identically across browsers.
//
// Storage: tokens are stored as SHA-256 hashes in the DB. The plaintext
// value is only ever surfaced once, at generation time. A DB leak
// reveals hashes but not live tokens.

import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';

const TOKEN_BYTES = 32; // 256 bits, base64url-encoded → 43 chars
const TOKEN_HASH_ALG = 'sha256';

export function generateToken(): { token: string; tokenHash: string; prefix: string } {
  // base64url so the token is URL-safe and copies cleanly without
  // shell-escape issues if anyone pastes it into a curl example.
  const raw = randomBytes(TOKEN_BYTES);
  const token = raw.toString('base64url');
  const tokenHash = createHash(TOKEN_HASH_ALG).update(token).digest('hex');
  const prefix = token.slice(0, 8);
  return { token, tokenHash, prefix };
}

export function hashToken(token: string): string {
  return createHash(TOKEN_HASH_ALG).update(token).digest('hex');
}

export type ClipperContext = {
  userId: string;
  tokenId: string;
};

/**
 * Validate `Authorization: Bearer <token>` against the DB. Returns the
 * user/token context on success, or null on any auth failure (missing
 * header, malformed, unknown token, deleted user).
 *
 * Updates `lastUsedAt` so the settings page can show stale tokens.
 * Fire-and-forget to avoid blocking the hot path.
 */
export async function verifyClipperToken(req: NextRequest): Promise<ClipperContext | null> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = await prisma.clipperToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  prisma.clipperToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id };
}

// Standard CORS preamble for clipper endpoints. The extension's origin
// is chrome-extension://<extension-id> which is well-defined and not
// a security risk to allow universally for these specific endpoints
// (which require a valid bearer token regardless of origin).
const ALLOW_HEADERS = 'Authorization, Content-Type';
const ALLOW_METHODS = 'GET, POST, OPTIONS';

export function corsHeaders(origin: string | null): HeadersInit {
  // Echo back the extension's origin so credentials/cookies aren't
  // needed (we use bearer tokens). Any chrome-extension://* is allowed.
  if (origin && origin.startsWith('chrome-extension://')) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': ALLOW_METHODS,
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Max-Age': '86400',
    };
  }
  // For dev / curl testing, just allow * — these endpoints require a
  // bearer token so origin isn't a security boundary here.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
}

export function corsPreflight(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  });
}

/** Helper to attach CORS headers to a normal JSON response. */
export function jsonWithCors(req: NextRequest, body: any, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...corsHeaders(req.headers.get('origin')), ...(init?.headers ?? {}) },
  });
}
