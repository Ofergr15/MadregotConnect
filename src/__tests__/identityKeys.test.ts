import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEYS, clearIdentityKeys } from '@/lib/auth/identity-keys';
import { STRAVA_OPEN_SYNC_PREFIX } from '@/lib/providers/open-sync';

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

// The keys above are matched by exact name, which silently stopped covering the
// dashboard's sync stamp the day that key gained an athlete-id suffix: the list
// says 'dashboard_synced', storage holds `dashboard_synced:<athleteId>`. A stamp
// that outlives the athlete means the NEXT person to sign in on the phone inherits
// their cooldown and their first app open skips the sync it needed.
//
// A more faithful storage stub than the block above, because this half of the
// function reads storage's own key enumeration rather than asking for names it
// already knows.
describe('clearIdentityKeys — per-athlete keys', () => {
  function fakeStorage(initial: Record<string, string>) {
    const store: Record<string, unknown> = { ...initial };
    Object.defineProperties(store, {
      getItem: {
        value: (k: string) => (typeof store[k] === 'string' ? (store[k] as string) : null),
        enumerable: false,
      },
      setItem: { value: (k: string, v: string) => { store[k] = v; }, enumerable: false },
      removeItem: { value: (k: string) => { delete store[k]; }, enumerable: false },
    });
    return store;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sweeps a stamp belonging to any athlete, and keeps unrelated keys', () => {
    const store = fakeStorage({
      athlete_id: '2d20dd3c',
      [`${STRAVA_OPEN_SYNC_PREFIX}2d20dd3c`]: '1757593332000',
      [`${STRAVA_OPEN_SYNC_PREFIX}9fd3d199`]: '1757500000000',
      'dashboard_synced:2d20dd3c': '1',
      locale: 'he',
      connect_data_source_dismissed: 'forever',
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', store);

    clearIdentityKeys();

    expect(Object.keys(store).sort()).toEqual(['connect_data_source_dismissed', 'locale']);
  });

  it('still clears the named keys when storage refuses to be enumerated', () => {
    // Private mode / quota-exhausted browsers can throw here, and losing a
    // cooldown stamp must not stop a sign-out from finishing.
    const store = fakeStorage({ athlete_id: '2d20dd3c' });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', store);
    const keys = vi.spyOn(Object, 'keys').mockImplementation(() => { throw new Error('denied'); });

    expect(() => clearIdentityKeys()).not.toThrow();
    keys.mockRestore();

    expect(store.athlete_id).toBeUndefined();
  });
});
