import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Db } from './types';
import { WATCH_TABLES } from './schema';

/**
 * Credentials for the companion iPhone app.
 *
 * Why not a Supabase session: the app needs to sync from a background wake
 * (HealthKit background delivery, BGAppRefresh) months after the athlete last
 * opened it, and the one server-side way this codebase has of minting a session —
 * `createSyntheticSession` — rotates the user's password to do it, which races
 * the PWA's own login. So the app gets its own, narrowly-scoped credential:
 *
 *  - a REFRESH token (`wrt1.…`), 32 random bytes, shown once at registration and
 *    stored only as a sha256 in `device_tokens`. 180 days, rotated on every use;
 *  - an ACCESS token (`wat1.…`), stateless, HMAC-signed with ENCRYPTION_KEY under
 *    its own label (the `lib/auth/device-token.ts` pattern), 15 minutes.
 *
 * Rotation catches a stolen refresh token: once a token has been exchanged, the
 * next use of it is either the app retrying a refresh whose answer it lost (a
 * 120-second grace window covers that, while the successor is still unused) or
 * somebody else — and then the whole device is revoked, which forces a fresh
 * sign-in on the real phone and locks the copy out.
 *
 * The access token only says WHO; whether the device is still allowed is checked
 * on every request (require-device.ts), so a revoke is immediate rather than
 * waiting out the 15 minutes.
 */

export const REFRESH_PREFIX = 'wrt1.';
export const ACCESS_PREFIX = 'wat1.';
export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 180 * 24 * 60 * 60_000;
export const ROTATION_GRACE_MS = 120_000;

const LABEL = 'watch-access-v1';

function keyMaterial(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newRefreshToken(): string {
  return `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export interface AccessClaims {
  deviceId: string;
  athleteId: string;
  issuedAt: number;
  expiresAt: number;
}

export function signAccessToken(
  claims: { deviceId: string; athleteId: string },
  now = Date.now(),
): { token: string; expiresAt: string } | null {
  const secret = keyMaterial();
  if (!secret) return null;
  const exp = now + ACCESS_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ v: 1, d: claims.deviceId, a: claims.athleteId, iat: now, exp }),
    'utf8',
  ).toString('base64url');
  const body = `${ACCESS_PREFIX}${payload}`;
  return { token: `${body}.${mac(secret, body)}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyAccessToken(token: string | null | undefined, now = Date.now()): AccessClaims | null {
  const secret = keyMaterial();
  if (!secret || !token || !token.startsWith(ACCESS_PREFIX)) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= ACCESS_PREFIX.length) return null;
  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(secret, body));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let claims: { v?: number; d?: unknown; a?: unknown; iat?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body.slice(ACCESS_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.v !== 1 || typeof claims.d !== 'string' || typeof claims.a !== 'string') return null;
  const iat = Number(claims.iat);
  const exp = Number(claims.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= now) return null;
  // Issued in the future beyond a minute of skew: not ours.
  if (iat - now > 60_000) return null;
  if (exp - iat > ACCESS_TTL_MS) return null;
  return { deviceId: claims.d, athleteId: claims.a, issuedAt: iat, expiresAt: exp };
}

export function isDeviceAccessToken(bearer: string): boolean {
  return bearer.startsWith(ACCESS_PREFIX);
}

/** Store a fresh refresh token for a device; returns the plaintext (never stored). */
export async function issueRefreshToken(
  db: Db,
  deviceId: string,
  now = Date.now(),
): Promise<{ token: string; id: string } | null> {
  const token = newRefreshToken();
  const { data, error } = await db
    .from(WATCH_TABLES.tokens)
    .insert({
      device_id: deviceId,
      token_hash: hashToken(token),
      expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return { token, id: (data as { id: string }).id };
}

interface TokenRow {
  id: string;
  device_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  replaced_by: string | null;
}

interface DeviceRow {
  id: string;
  athlete_id: string;
  revoked_at: string | null;
}

export type RotateResult =
  | { ok: true; deviceId: string; athleteId: string; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' | 'error' };

/** Revoke a device and every token it holds. Idempotent. */
export async function revokeDevice(db: Db, deviceId: string, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  await db.from(WATCH_TABLES.devices).update({ revoked_at: at }).eq('id', deviceId).is('revoked_at', null);
  await db.from(WATCH_TABLES.tokens).update({ revoked_at: at }).eq('device_id', deviceId).is('revoked_at', null);
}

async function loadToken(db: Db, column: 'token_hash' | 'id', value: string): Promise<TokenRow | null> {
  const { data } = await db
    .from(WATCH_TABLES.tokens)
    .select('id, device_id, expires_at, used_at, revoked_at, replaced_by')
    .eq(column, value)
    .maybeSingle();
  return (data as TokenRow | null) ?? null;
}

async function mintSuccessor(db: Db, row: TokenRow, now: number): Promise<string | null> {
  const next = await issueRefreshToken(db, row.device_id, now);
  if (!next) return null;
  await db.from(WATCH_TABLES.tokens).update({ replaced_by: next.id }).eq('id', row.id);
  return next.token;
}

/**
 * Exchange a refresh token for its successor. The caller signs the access token
 * from the returned ids.
 */
export async function rotateRefreshToken(db: Db, presented: string, now = Date.now()): Promise<RotateResult> {
  if (!presented || !presented.startsWith(REFRESH_PREFIX)) return { ok: false, reason: 'unknown' };
  const row = await loadToken(db, 'token_hash', hashToken(presented));
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now) return { ok: false, reason: 'expired' };

  const { data: deviceData } = await db
    .from(WATCH_TABLES.devices)
    .select('id, athlete_id, revoked_at')
    .eq('id', row.device_id)
    .maybeSingle();
  const device = deviceData as DeviceRow | null;
  if (!device || device.revoked_at) return { ok: false, reason: 'revoked' };

  if (!row.used_at) {
    // Conditional on still being unused, so two concurrent refreshes with the
    // same token can't both win: the loser falls through to the reuse rules.
    const { data: claimed } = await db
      .from(WATCH_TABLES.tokens)
      .update({ used_at: new Date(now).toISOString() })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id');
    if (Array.isArray(claimed) && claimed.length === 1) {
      const token = await mintSuccessor(db, row, now);
      if (!token) return { ok: false, reason: 'error' };
      return { ok: true, deviceId: device.id, athleteId: device.athlete_id, refreshToken: token };
    }
    const reread = await loadToken(db, 'id', row.id);
    if (!reread) return { ok: false, reason: 'unknown' };
    Object.assign(row, reread);
  }

  // Already exchanged. Inside the grace window, and nobody has used what it was
  // exchanged for yet ⇒ the app lost the answer; hand it a new one.
  const usedAt = row.used_at ? new Date(row.used_at).getTime() : 0;
  if (now - usedAt <= ROTATION_GRACE_MS) {
    const successor = row.replaced_by ? await loadToken(db, 'id', row.replaced_by) : null;
    if (!successor || (!successor.used_at && !successor.revoked_at)) {
      if (successor) {
        await db.from(WATCH_TABLES.tokens).update({ revoked_at: new Date(now).toISOString() }).eq('id', successor.id);
      }
      const token = await mintSuccessor(db, row, now);
      if (!token) return { ok: false, reason: 'error' };
      return { ok: true, deviceId: device.id, athleteId: device.athlete_id, refreshToken: token };
    }
  }

  await revokeDevice(db, device.id, now);
  return { ok: false, reason: 'reused' };
}
