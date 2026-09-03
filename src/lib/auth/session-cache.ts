import { createHash } from 'crypto';

/**
 * Per-instance memo for resolved sessions.
 *
 * Every authenticated request used to pay two sequential REMOTE round trips
 * before doing any of its own work: `auth.getUser(token)` against Supabase Auth
 * to turn the JWT into an email, then an `athletes` select on that email (and a
 * third against `coaches` for a legacy staff account). Neither can be
 * parallelised — the second needs the first's answer.
 *
 * That cost is per REQUEST, not per page, and the app's pages fan out hard:
 * /dashboard/plan/new fires 23, /dashboard/profile 16, /dashboard/settings 12.
 * A single profile open therefore spent ~32 serialised round trips resolving
 * the same one session over and over.
 *
 * So: memoise it. Keyed by the token, held only as long as the token itself is
 * good, and collapsed across a concurrent burst so a page's 16 parallel
 * requests trigger one lookup rather than 16.
 *
 * Deliberately in-process rather than a shared cache: a warm serverless
 * instance handles a page's whole burst, which is exactly the window that
 * matters, and it keeps the hot path free of yet another network hop.
 */

/** How long a verified session may be reused. */
export const DEFAULT_TTL_MS = 60_000;

/** Entry ceiling, so a long-lived instance can't grow this without bound. */
const MAX_ENTRIES = 500;

interface Entry<T> {
  value: T;
  /** Epoch ms after which this must be re-resolved. */
  expiresAt: number;
}

const cache = new Map<string, Entry<unknown>>();
/** Resolutions currently in flight, so a burst shares one lookup. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Cache key for a bearer token. Hashed so that a long-lived map isn't holding
 * verbatim credentials any longer than the request that presented them.
 */
export function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The `exp` claim (epoch SECONDS) from a JWT payload, without verifying the
 * signature. Returns null for anything unparseable.
 *
 * SECURITY: the only claims this may be used for are lifetime ones — `exp`
 * here, to reject a stale token early and to cap how long a verified result is
 * reused. Identity (email / sub) must NEVER be read this way, because an
 * unverified payload is entirely attacker-controlled; that still comes from
 * Supabase's own verification. Reading `exp` from an unverified token is safe
 * in the only direction that matters: a forged `exp` can make a token look
 * expired (denying the forger), and a generous one still faces real
 * verification before anything is cached.
 */
export function tokenExpirySeconds(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** True when the token says it has already expired — a free 401, no network. */
export function isTokenExpired(token: string, nowMs: number = Date.now()): boolean {
  const exp = tokenExpirySeconds(token);
  return exp !== null && exp * 1000 <= nowMs;
}

/**
 * When a result for this token should stop being reused: the shorter of the
 * TTL and the token's own expiry, so a session is never honoured here past the
 * point Supabase itself would stop honouring it.
 */
export function entryExpiry(token: string, nowMs: number = Date.now(), ttlMs: number = DEFAULT_TTL_MS): number {
  const byTtl = nowMs + ttlMs;
  const exp = tokenExpirySeconds(token);
  if (exp === null) return byTtl;
  return Math.min(byTtl, exp * 1000);
}

/**
 * Resolve `key` through the cache: a live entry is returned as-is, a
 * concurrent resolution is awaited rather than duplicated, and anything else
 * calls `resolve` and stores the result.
 *
 * Only successful resolutions are cached — `shouldCache` decides. A failure
 * stays uncached on purpose: an athlete who was just approved, or whose row was
 * just created, must not be locked out for the rest of the TTL by a negative
 * answer, and failures are rare enough that re-resolving them costs nothing.
 */
export async function resolveCached<T>(
  key: string,
  expiresAt: number,
  resolve: () => Promise<T>,
  shouldCache: (value: T) => boolean,
): Promise<T> {
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) cache.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = resolve()
    .then((value) => {
      if (shouldCache(value)) {
        if (cache.size >= MAX_ENTRIES) {
          // Insertion-ordered, so the first key is the oldest.
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { value, expiresAt });
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Drop a single token's entry — for the moment a request knowingly invalidates
 * what the entry says (a role change, an approval, a deactivation).
 */
export function invalidateToken(token: string): void {
  cache.delete(tokenKey(token));
}

/** Drop everything. Exported for tests and for a global role/permission change. */
export function clearSessionCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Live entry count, for tests and diagnostics. */
export function sessionCacheSize(): number {
  return cache.size;
}
