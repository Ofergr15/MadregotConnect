import { createHmac, timingSafeEqual } from 'crypto';

// Server-signed proof that THIS browser once completed a real login.
//
// /api/auth/silent-session re-mints a Supabase session for an athlete whose
// session has lapsed (see that route for why it exists). The problem it has to
// solve is that a browser in that state holds no verifiable credential at all —
// only a localStorage email — so the route originally accepted a bare email and
// handed back real tokens for it. Knowing any club member's address was enough
// to take over their account, staff included.
//
// This cookie is the missing credential: issued only against a real Supabase JWT
// (POST /api/auth/device-token), httpOnly so page scripts can't read it, and
// carrying the email inside a signed payload so silent-session never has to
// trust a client-supplied one.
//
// Signed with ENCRYPTION_KEY under a distinct label rather than a new env var,
// so no environment needs reconfiguring — the key is already required for the
// app to boot. Absent key ⇒ sign and verify both fail, so the route fails
// closed rather than falling back to trusting the caller.

export const DEVICE_COOKIE = 'mc_device';

const VERSION = 'v1';
const LABEL = 'device-token-v1';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};

function keyMaterial(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** Sign a device token for `email`. Returns null when ENCRYPTION_KEY is unusable. */
export function signDeviceToken(email: string, issuedAtMs = Date.now()): string | null {
  const secret = keyMaterial();
  if (!secret) return null;
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;
  const payload = Buffer.from(normalized, 'utf8').toString('base64url');
  const body = `${VERSION}.${payload}.${issuedAtMs}`;
  return `${body}.${mac(secret, body)}`;
}

/**
 * Verify a device token and return the email it was issued for, or null if it
 * is missing, malformed, forged, or older than a year.
 */
export function readDeviceToken(token: string | undefined | null, nowMs = Date.now()): string | null {
  const secret = keyMaterial();
  if (!secret || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, payload, issuedAt, provided] = parts;
  if (version !== VERSION) return null;

  const expected = mac(secret, `${version}.${payload}.${issuedAt}`);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which is itself a rejection.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || issued <= 0) return null;
  if (nowMs - issued > MAX_AGE_SECONDS * 1000) return null;
  // A token stamped in the future means a tampered (but somehow valid) clock;
  // allow a minute of skew and reject beyond it.
  if (issued - nowMs > 60_000) return null;

  const email = Buffer.from(payload, 'base64url').toString('utf8').toLowerCase().trim();
  return email.includes('@') ? email : null;
}
