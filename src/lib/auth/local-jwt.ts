import { webcrypto } from 'node:crypto';

/**
 * Local verification of a Supabase access token against the project's JWKS
 * (asymmetric signing keys, ES256 — RS256 accepted too), instead of a network
 * `auth.getUser` round trip on every cold session (~200-450 ms from iad1 to
 * Tokyo, PERF-BASELINE fix B).
 *
 * Outcomes:
 *  - `valid`    — signature checks against a published key, not expired,
 *                 audience `authenticated`, issuer this project's auth. Email
 *                 comes from the VERIFIED payload.
 *  - `invalid`  — a key we hold says the signature is wrong, or the verified
 *                 payload is expired / for another audience or issuer → 401.
 *  - `fallback` — we cannot decide locally (JWKS unreachable, legacy HS256
 *                 token, unknown `kid` even after a refresh, malformed header):
 *                 the caller does the old network check, unchanged.
 *
 * CAVEAT (accepted): a token whose session was revoked (sign-out elsewhere,
 * user deleted) keeps verifying here until its own `exp` (≤ 1 h by default).
 * `getUser` would have caught it. The membership row is still read fresh per
 * session-cache entry, so a deactivated athlete is still refused by role/status.
 */

const subtle = webcrypto.subtle;

export const JWKS_TTL_MS = 10 * 60_000;
/** Minimum gap between forced refreshes for an unknown kid, so junk kids can't hammer auth. */
const REFRESH_COOLDOWN_MS = 30_000;
const FETCH_TIMEOUT_MS = 1500;
/**
 * How long the last good JWKS may still be used after refreshes start failing.
 * Past this, verification falls back to getUser rather than trusting keys that
 * may have been rotated out (or revoked) since.
 */
export const JWKS_MAX_STALE_MS = 60 * 60_000;

type Jwk = { kid?: string; kty: string; alg?: string; crv?: string; x?: string; y?: string; n?: string; e?: string };

let jwks: { keys: Jwk[]; at: number; url: string } | null = null;
let lastForced = 0;
const keyCache = new Map<string, CryptoKey>();

/** Test hook: age the cached JWKS as if it was fetched `ms` ago. */
export function ageJwksCacheForTest(ms: number): void {
  if (jwks) jwks.at -= ms;
  lastForced = 0;
}

export function resetJwksCache(): void {
  jwks = null;
  lastForced = 0;
  keyCache.clear();
}

async function loadJwks(supabaseUrl: string, force: boolean): Promise<Jwk[] | null> {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  const now = Date.now();
  if (!force && jwks && jwks.url === url && now - jwks.at < JWKS_TTL_MS) return jwks.keys;
  const lastGood = () => (jwks && jwks.url === url && now - jwks.at < JWKS_MAX_STALE_MS ? jwks.keys : null);
  if (force && now - lastForced < REFRESH_COOLDOWN_MS) return lastGood();
  if (force) lastForced = now;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return lastGood();
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwks = { keys, at: now, url };
    keyCache.clear();
    return keys;
  } catch {
    return lastGood();
  }
}

function b64urlBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

const KTY_FOR_ALG: Record<string, string> = { ES256: 'EC', RS256: 'RSA' };

function algParams(alg: string): { importAlg: EcKeyImportParams | RsaHashedImportParams; verifyAlg: EcdsaParams | AlgorithmIdentifier } | null {
  if (alg === 'ES256') return { importAlg: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAlg: { name: 'ECDSA', hash: 'SHA-256' } };
  if (alg === 'RS256') return { importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAlg: { name: 'RSASSA-PKCS1-v1_5' } };
  return null;
}

export type LocalVerdict =
  | { kind: 'valid'; email: string; sub: string | null }
  | { kind: 'invalid'; reason: string }
  | { kind: 'fallback'; reason: string };

export async function verifyAccessTokenLocally(token: string, supabaseUrl: string, nowMs = Date.now()): Promise<LocalVerdict> {
  const parts = token.split('.');
  if (parts.length !== 3) return { kind: 'fallback', reason: 'malformed' };
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(b64urlBytes(parts[0])).toString('utf8'));
  } catch {
    return { kind: 'fallback', reason: 'malformed' };
  }
  const params = header.alg ? algParams(header.alg) : null;
  // HS256 (legacy shared secret) and anything else we don't hold a public key for.
  if (!params || !header.kid) return { kind: 'fallback', reason: `alg:${header.alg ?? 'none'}` };

  let keys = await loadJwks(supabaseUrl, false);
  if (!keys) return { kind: 'fallback', reason: 'jwks-unavailable' };
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(supabaseUrl, true);
    jwk = keys?.find((k) => k.kid === header.kid);
    if (!jwk) return { kind: 'fallback', reason: 'unknown-kid' };
  }
  if (jwk.alg && jwk.alg !== header.alg) return { kind: 'invalid', reason: 'alg-mismatch' };
  if (jwk.kty !== KTY_FOR_ALG[header.alg!]) return { kind: 'invalid', reason: 'kty-mismatch' };

  let key = keyCache.get(header.kid);
  try {
    if (!key) {
      key = await subtle.importKey('jwk', jwk as JsonWebKey, params.importAlg, false, ['verify']);
      keyCache.set(header.kid, key);
    }
  } catch {
    return { kind: 'fallback', reason: 'bad-jwk' };
  }
  const ok = await subtle
    .verify(params.verifyAlg, key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    .catch(() => false);
  if (!ok) return { kind: 'invalid', reason: 'signature' };

  let payload: { exp?: unknown; aud?: unknown; iss?: unknown; role?: unknown; email?: unknown; sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(b64urlBytes(parts[1])).toString('utf8'));
  } catch {
    return { kind: 'invalid', reason: 'payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return { kind: 'invalid', reason: 'expired' };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes('authenticated')) return { kind: 'invalid', reason: 'audience' };
  const iss = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  if (payload.iss !== iss) return { kind: 'invalid', reason: 'issuer' };
  // An anon/service key is signed by the same project; only a user session may pass.
  if (payload.role !== 'authenticated') return { kind: 'invalid', reason: 'role' };
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
  return { kind: 'valid', email, sub: typeof payload.sub === 'string' ? payload.sub : null };
}
