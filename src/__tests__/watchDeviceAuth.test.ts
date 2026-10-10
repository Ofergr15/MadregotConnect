import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCESS_TTL_MS,
  hashToken,
  isDeviceAccessToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/watch/device-auth';

const KEY = 'b'.repeat(64);
const claims = { deviceId: 'dev-1', athleteId: 'ath-1' };

afterEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
});
process.env.ENCRYPTION_KEY = KEY;

describe('access tokens', () => {
  it('round-trips the claims', () => {
    const now = 1_760_000_000_000;
    const signed = signAccessToken(claims, now)!;
    expect(signed.token).toMatch(/^wat1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyAccessToken(signed.token, now + 1000)).toEqual({ ...claims, issuedAt: now, expiresAt: now + ACCESS_TTL_MS });
    expect(new Date(signed.expiresAt).getTime()).toBe(now + ACCESS_TTL_MS);
  });

  it('expires', () => {
    const now = 1_760_000_000_000;
    const { token } = signAccessToken(claims, now)!;
    expect(verifyAccessToken(token, now + ACCESS_TTL_MS)).toBeNull();
  });

  it('rejects a token stamped in the future', () => {
    const now = 1_760_000_000_000;
    const { token } = signAccessToken(claims, now + 5 * 60_000)!;
    expect(verifyAccessToken(token, now)).toBeNull();
  });

  it('rejects any edit to the payload or the signature', () => {
    const { token } = signAccessToken(claims)!;
    const [prefix, payload, sig] = [token.slice(0, 5), token.slice(5, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), a: 'ath-2' })).toString('base64url');
    expect(verifyAccessToken(`${prefix}${evil}.${sig}`)).toBeNull();
    expect(verifyAccessToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(verifyAccessToken(token.replace('wat1.', 'wat2.'))).toBeNull();
    expect(verifyAccessToken('')).toBeNull();
    expect(verifyAccessToken('wat1.')).toBeNull();
  });

  it('a token signed under another key, or with no key at all, is refused (fail closed)', () => {
    const { token } = signAccessToken(claims)!;
    process.env.ENCRYPTION_KEY = 'c'.repeat(64);
    expect(verifyAccessToken(token)).toBeNull();
    delete process.env.ENCRYPTION_KEY;
    expect(verifyAccessToken(token)).toBeNull();
    expect(signAccessToken(claims)).toBeNull();
  });

  it('is distinguishable from a Supabase JWT', () => {
    expect(isDeviceAccessToken(signAccessToken(claims)!.token)).toBe(true);
    expect(isDeviceAccessToken('eyJhbGciOiJIUzI1NiJ9.e30.x')).toBe(false);
  });
});

describe('refresh tokens', () => {
  it('are 256-bit random and stored as sha256', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^wrt1\.[A-Za-z0-9_-]{43}$/);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(5));
  });
});
