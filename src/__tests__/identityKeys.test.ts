import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEYS, clearIdentityKeys } from '@/lib/auth/identity-keys';

// The audit finding this guards: clearLocalIdentity() and the Header's logout
// each kept their own key list, and clearLocalIdentity's was missing
// 'admin_session'. Signing in as an athlete on a browser that had been the admin
// left admin_session === 'true' behind and the athlete got staff UI.
describe('IDENTITY_KEYS', () => {
  it('includes the elevated-state keys a stale value would leak', () => {
    expect(IDENTITY_KEYS).toContain('admin_session');
    expect(IDENTITY_KEYS).toContain('view_as_role');
  });

  it('includes every athlete identity key', () => {
    for (const key of ['athlete_id', 'athlete_name', 'athlete_email', 'athlete_group_id', 'coach_email']) {
      expect(IDENTITY_KEYS).toContain(key);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(IDENTITY_KEYS).size).toBe(IDENTITY_KEYS.length);
  });
});

describe('clearIdentityKeys', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes every identity key, leaving unrelated keys alone', () => {
    for (const key of IDENTITY_KEYS) store.set(key, 'x');
    store.set('connect_data_source_dismissed', 'forever');
    store.set('locale', 'he');

    clearIdentityKeys();

    for (const key of IDENTITY_KEYS) expect(store.has(key)).toBe(false);
    expect(store.get('connect_data_source_dismissed')).toBe('forever');
    expect(store.get('locale')).toBe('he');
  });

  it('takes the persistent SWR cache with it', () => {
    // That cache holds the signed-in member's actual club data — their runs, their
    // paces, the feed they could see — and it is scoped by the very keys this
    // function removes. Leaving it behind would mean the next person to sign in on
    // the phone gets a screen painted from the last person's data before any
    // request answers. It hangs off THIS function rather than off
    // signOutEverywhere because clearLocalIdentity() (the path before a new
    // Strava/Google sign-in) is the case where that actually happens.
    store.set('athlete_id', 'a1');
    store.set('mc_swr_cache_v1', '{"v":"x","id":"a1|","e":[]}');

    clearIdentityKeys();

    expect(store.has('mc_swr_cache_v1')).toBe(false);
  });

  it('is a no-op on the server rather than throwing', () => {
    vi.stubGlobal('window', undefined);
    expect(() => clearIdentityKeys()).not.toThrow();
  });
});
