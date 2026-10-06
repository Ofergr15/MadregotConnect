// Sign in with a 6-digit code mailed to the member (migration 132) — the way in
// for a member with no Strava, who until now had none at all. The pure half:
// making a code, hashing it, and the limits. The route is /api/auth/email-code.
//
// The code is never stored, only an HMAC of it under ENCRYPTION_KEY (own label,
// like the device token), bound to the address so a hash cannot be replayed for
// someone else. Five wrong tries burn a code; three sends per quarter hour per
// address stop the form from being used to flood an inbox.

import { createHmac, randomInt, timingSafeEqual } from 'crypto';

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 3;
export const SEND_WINDOW_MS = 15 * 60_000;
const LABEL = 'login-code-v1';

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Digits only, so "123 456" and "123-456" (how people paste it) still match. */
export function normaliseCode(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '').slice(0, 6);
}

export function hashCode(email: string, code: string): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return createHmac('sha256', `${key}:${LABEL}`).update(`${email.toLowerCase().trim()}:${code}`).digest('base64url');
}

export function codeMatches(email: string, code: string, storedHash: string): boolean {
  const h = hashCode(email, code);
  if (!h || h.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(storedHash));
}
