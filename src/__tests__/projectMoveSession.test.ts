import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAuthConfig, expireForeignSession, sessionStorageKey } from '@/lib/supabase/client';

/**
 * Moving the database to a new Supabase project (Tokyo → Frankfurt) changes the
 * project ref, and with it the key every phone keeps its session under. These
 * are the two pieces that keep the club signed in across that move.
 */
const OLD = 'https://njzldypndkicpsmdtyll.supabase.co';
const NEW = 'https://abcdefghijklmnopqrst.supabase.co';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (iss: string) => `${b64({ alg: 'HS256' })}.${b64({ iss, sub: 'u1' })}.sig`;
const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

afterEach(() => vi.unstubAllEnvs());

describe('sessionStorageKey', () => {
  it('derives from the project URL by default, exactly as supabase-js does', () => {
    expect(sessionStorageKey(NEW)).toBe(browserAuthConfig(NEW).storageKey);
  });
  it('can be pinned to the old project key, so phones keep finding their session', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY', 'sb-njzldypndkicpsmdtyll-auth-token');
    expect(sessionStorageKey(NEW)).toBe('sb-njzldypndkicpsmdtyll-auth-token');
  });
});

describe('expireForeignSession', () => {
  const key = 'sb-njzldypndkicpsmdtyll-auth-token';
  const newAuth = browserAuthConfig(NEW).authUrl;

  it('marks a session minted by the old project expired, keeping its refresh token', () => {
    const s = store();
    s.setItem(key, JSON.stringify({ access_token: jwt(`${OLD}/auth/v1`), refresh_token: 'r1', expires_at: 9999999999 }));
    expect(expireForeignSession(s, key, newAuth)).toBe(true);
    expect(JSON.parse(s.m.get(key)!)).toMatchObject({ refresh_token: 'r1', expires_at: 0 });
  });

  it('leaves a session from this project alone (trailing slash or not)', () => {
    const s = store();
    const raw = JSON.stringify({ access_token: jwt(`${NEW}/auth/v1`), refresh_token: 'r1', expires_at: 9999999999 });
    s.setItem(key, raw);
    expect(expireForeignSession(s, key, newAuth.replace(/\/?$/, '/'))).toBe(false);
    expect(s.m.get(key)).toBe(raw);
  });

  it('never touches a token whose issuer is not a URL', () => {
    const s = store();
    const raw = JSON.stringify({ access_token: jwt('supabase'), refresh_token: 'r1', expires_at: 9999999999 });
    s.setItem(key, raw);
    expect(expireForeignSession(s, key, newAuth)).toBe(false);
    expect(s.m.get(key)).toBe(raw);
  });

  it('does nothing, and never throws, on no session or a malformed one', () => {
    const s = store();
    expect(expireForeignSession(s, key, newAuth)).toBe(false);
    s.setItem(key, '{not json');
    expect(expireForeignSession(s, key, newAuth)).toBe(false);
    s.setItem(key, JSON.stringify({ access_token: 'no-dots' }));
    expect(expireForeignSession(s, key, newAuth)).toBe(false);
  });
});
