import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_TTL_MS,
  tokenKey,
  tokenExpirySeconds,
  isTokenExpired,
  entryExpiry,
  resolveCached,
  invalidateToken,
  clearSessionCache,
  sessionCacheSize,
} from '@/lib/auth/session-cache';

/** A JWT-shaped string with the given payload. Signature is never inspected. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.notarealsignature`;
}

const NOW = 1_760_000_000_000; // fixed epoch ms

beforeEach(() => {
  clearSessionCache();
});

describe('tokenExpirySeconds', () => {
  it('reads exp out of an unverified payload', () => {
    expect(tokenExpirySeconds(jwt({ exp: 1_760_000_100, email: 'a@b.c' }))).toBe(1_760_000_100);
  });

  it('returns null when the token is not three dot-separated parts', () => {
    expect(tokenExpirySeconds('not.ajwt')).toBeNull();
    expect(tokenExpirySeconds('')).toBeNull();
  });

  it('returns null for an unparseable payload rather than throwing', () => {
    expect(tokenExpirySeconds('aaa.notbase64json.bbb')).toBeNull();
  });

  it('returns null when exp is absent or not a finite number', () => {
    expect(tokenExpirySeconds(jwt({ email: 'a@b.c' }))).toBeNull();
    expect(tokenExpirySeconds(jwt({ exp: 'soon' }))).toBeNull();
    expect(tokenExpirySeconds(jwt({ exp: Infinity }))).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('is true once exp has passed', () => {
    expect(isTokenExpired(jwt({ exp: NOW / 1000 - 1 }), NOW)).toBe(true);
  });

  it('is false while exp is still ahead', () => {
    expect(isTokenExpired(jwt({ exp: NOW / 1000 + 60 }), NOW)).toBe(false);
  });

  it('is false when there is no exp to judge — real verification decides', () => {
    expect(isTokenExpired(jwt({ email: 'a@b.c' }), NOW)).toBe(false);
    expect(isTokenExpired('garbage', NOW)).toBe(false);
  });
});

describe('entryExpiry', () => {
  it('uses the TTL when the token outlives it', () => {
    const t = jwt({ exp: NOW / 1000 + 3600 });
    expect(entryExpiry(t, NOW)).toBe(NOW + DEFAULT_TTL_MS);
  });

  it('never reuses a session past the token\'s own expiry', () => {
    const t = jwt({ exp: NOW / 1000 + 5 });
    expect(entryExpiry(t, NOW)).toBe(NOW + 5000);
  });

  it('falls back to the TTL when exp is unreadable', () => {
    expect(entryExpiry('garbage', NOW)).toBe(NOW + DEFAULT_TTL_MS);
  });

  it('honours an explicit ttl', () => {
    expect(entryExpiry(jwt({}), NOW, 5000)).toBe(NOW + 5000);
  });
});

describe('tokenKey', () => {
  it('is stable for the same token and differs across tokens', () => {
    expect(tokenKey('abc')).toBe(tokenKey('abc'));
    expect(tokenKey('abc')).not.toBe(tokenKey('abd'));
  });

  it('does not retain the token verbatim', () => {
    const secret = 'super-secret-token-value';
    expect(tokenKey(secret)).not.toContain(secret);
  });
});

describe('resolveCached', () => {
  const ok = { ok: true as const, user: 'ofer' };

  it('resolves once and serves the cached value after', async () => {
    let calls = 0;
    const resolve = async () => { calls++; return ok; };

    expect(await resolveCached('k', Date.now() + 60_000, resolve, r => r.ok)).toEqual(ok);
    expect(await resolveCached('k', Date.now() + 60_000, resolve, r => r.ok)).toEqual(ok);
    expect(calls).toBe(1);
  });

  it('collapses a concurrent burst into a single resolution', async () => {
    let calls = 0;
    const resolve = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 5));
      return ok;
    };

    // The shape that made pages slow: many requests for one session at once.
    const results = await Promise.all(
      Array.from({ length: 16 }, () => resolveCached('burst', Date.now() + 60_000, resolve, r => r.ok)),
    );

    expect(calls).toBe(1);
    expect(results).toHaveLength(16);
    results.forEach(r => expect(r).toEqual(ok));
  });

  it('does not cache a failure, so an approval is not locked out for the TTL', async () => {
    let calls = 0;
    const resolve = async () => { calls++; return { ok: false as const }; };

    await resolveCached('k', Date.now() + 60_000, resolve, r => r.ok);
    await resolveCached('k', Date.now() + 60_000, resolve, r => r.ok);

    expect(calls).toBe(2);
    expect(sessionCacheSize()).toBe(0);
  });

  it('re-resolves once the entry has expired', async () => {
    let calls = 0;
    const resolve = async () => { calls++; return ok; };

    await resolveCached('k', Date.now() - 1, resolve, r => r.ok); // already stale
    await resolveCached('k', Date.now() + 60_000, resolve, r => r.ok);

    expect(calls).toBe(2);
  });

  it('keeps separate entries per key', async () => {
    const resolve = async () => ok;
    await resolveCached('a', Date.now() + 60_000, resolve, r => r.ok);
    await resolveCached('b', Date.now() + 60_000, resolve, r => r.ok);
    expect(sessionCacheSize()).toBe(2);
  });

  it('releases the in-flight slot when a resolution throws', async () => {
    let calls = 0;
    const boom = async () => { calls++; throw new Error('network'); };

    await expect(resolveCached('k', Date.now() + 60_000, boom, () => true)).rejects.toThrow('network');
    await expect(resolveCached('k', Date.now() + 60_000, boom, () => true)).rejects.toThrow('network');

    expect(calls).toBe(2); // not wedged on the first failed promise
  });
});

describe('invalidateToken', () => {
  it('forces the next request for that token to re-resolve', async () => {
    let calls = 0;
    const token = jwt({ exp: NOW / 1000 + 3600 });
    const resolve = async () => { calls++; return { ok: true as const }; };

    await resolveCached(tokenKey(token), Date.now() + 60_000, resolve, r => r.ok);
    invalidateToken(token);
    await resolveCached(tokenKey(token), Date.now() + 60_000, resolve, r => r.ok);

    expect(calls).toBe(2);
  });
});
