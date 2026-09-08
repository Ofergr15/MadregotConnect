import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/lib/version';
import { clearPersistedSWRCache, persistedCacheProvider } from '@/lib/swr-persist';

/**
 * The persistent SWR cache writes this member's club data to localStorage, which
 * makes two of its rules load-bearing rather than tidy:
 *
 *  - it belongs to ONE identity, and a different one must not read it (a shared
 *    phone, or the club's one iPad, would otherwise paint the previous person's
 *    kilometres before the network answered);
 *  - it belongs to ONE deploy, because a restored response of the old shape gets
 *    handed to a screen that no longer understands it, with no failing request
 *    anywhere to explain the blank card.
 *
 * Neither is visible to the type checker or to a build, and neither shows up in
 * normal use — only on somebody else's phone, or on the first load after a
 * deploy. Hence this file.
 */

const STORAGE_KEY = 'mc_swr_cache_v1';

const store = new Map<string, string>();
let listeners: string[] = [];

function blob(entries: [string, unknown][], over: Partial<{ v: string; id: string }> = {}) {
  return JSON.stringify({ v: APP_VERSION, id: 'a1|', e: entries, ...over });
}

beforeEach(() => {
  store.clear();
  listeners = [];
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    addEventListener: (name: string) => void listeners.push(name),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (name: string) => void listeners.push(name),
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Sign this browser in as the given athlete id. */
function signedInAs(id: string) {
  store.set('athlete_id', id);
}

/** What the provider would have written, parsed. */
function written(): { v: string; id: string; e: [string, unknown][] } | null {
  const raw = store.get(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('persistedCacheProvider — restoring', () => {
  it('restores the last answer for the same person and the same deploy', () => {
    signedInAs('a1');
    store.set(STORAGE_KEY, blob([['/api/dashboard/weekly', { totalKm: 42 }]]));

    const cache = persistedCacheProvider();

    expect(cache.get('/api/dashboard/weekly')).toEqual({ data: { totalKm: 42 } });
  });

  it('restores ONLY `data` — never a persisted error or in-flight flag', () => {
    signedInAs('a1');
    store.set(STORAGE_KEY, blob([['/api/feed', { items: [] }]]));

    const state = persistedCacheProvider().get('/api/feed');

    // A restored `error` would render a failure screen for a request that never
    // ran; a restored `isValidating: true` describes a fetch that died with the
    // page and leaves a skeleton nothing will ever replace.
    expect(state).toEqual({ data: { items: [] } });
    expect(state).not.toHaveProperty('error');
    expect(state).not.toHaveProperty('isValidating');
  });

  it('refuses — and deletes — a cache belonging to somebody else', () => {
    signedInAs('a2');
    store.set(STORAGE_KEY, blob([['/api/feed', { items: ['a1 private run'] }]], { id: 'a1|' }));

    expect(persistedCacheProvider().get('/api/feed')).toBeUndefined();
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('refuses — and deletes — a cache written by a different deploy', () => {
    signedInAs('a1');
    store.set(STORAGE_KEY, blob([['/api/feed', { items: [] }]], { v: '0.0.1-old' }));

    expect(persistedCacheProvider().get('/api/feed')).toBeUndefined();
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('drops whatever the last session left when nobody is signed in', () => {
    store.set(STORAGE_KEY, blob([['/api/feed', { items: ['a1 private run'] }]]));

    expect(persistedCacheProvider().get('/api/feed')).toBeUndefined();
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('survives a corrupt blob rather than taking the app down with it', () => {
    signedInAs('a1');
    store.set(STORAGE_KEY, '{not json');

    expect(() => persistedCacheProvider()).not.toThrow();
    expect(store.has(STORAGE_KEY)).toBe(false);
  });
});

describe('persistedCacheProvider — writing', () => {
  it('writes on a debounce, under the current identity', () => {
    signedInAs('a1');
    const cache = persistedCacheProvider();

    cache.set('/api/dashboard/stats', { data: { streak: 7 } });
    // Not yet: SWR touches the cache several times per request and a page load is
    // dozens of those, so the writes are coalesced.
    expect(store.has(STORAGE_KEY)).toBe(false);

    vi.advanceTimersByTime(2000);

    expect(written()).toEqual({
      v: APP_VERSION,
      id: 'a1|',
      e: [['/api/dashboard/stats', { streak: 7 }]],
    });
  });

  it('starts writing after a mid-session sign-in, not only from the next load', () => {
    // Signing in is a soft navigation: this provider is built once, before there is
    // anybody to scope a cache to. An earlier version bailed out entirely in that
    // state, so the session right after a login was the one that never got a cache.
    const cache = persistedCacheProvider();
    cache.set('/api/feed', { data: { items: [1] } });
    vi.advanceTimersByTime(2000);
    expect(store.has(STORAGE_KEY)).toBe(false);

    signedInAs('a9');
    cache.set('/api/feed', { data: { items: [1, 2] } });
    vi.advanceTimersByTime(2000);

    expect(written()?.id).toBe('a9|');
  });

  it('never persists an entry with no data — an error or a pending fetch', () => {
    signedInAs('a1');
    const cache = persistedCacheProvider();

    cache.set('/api/broken', { error: new Error('boom') });
    cache.set('/api/pending', { isLoading: true, isValidating: true });
    cache.set('/api/good', { data: { ok: true } });
    vi.advanceTimersByTime(2000);

    expect(written()?.e).toEqual([['/api/good', { ok: true }]]);
  });

  it('skips one oversized entry instead of letting it eat the whole budget', () => {
    signedInAs('a1');
    const cache = persistedCacheProvider();

    cache.set('/api/huge', { data: { blob: 'x'.repeat(200_000) } });
    cache.set('/api/small', { data: { n: 1 } });
    vi.advanceTimersByTime(2000);

    expect(written()?.e).toEqual([['/api/small', { n: 1 }]]);
  });

  it('stops at the total budget rather than blowing the localStorage quota', () => {
    // The origin's ~5 MB is shared with the Supabase session and the identity
    // keys, and losing THOSE to a warm feed cache would sign the club out.
    signedInAs('a1');
    const cache = persistedCacheProvider();
    for (let i = 0; i < 20; i++) {
      cache.set(`/api/page/${i}`, { data: { blob: 'x'.repeat(100_000) } });
    }
    vi.advanceTimersByTime(2000);

    const e = written()!.e;
    expect(e.length).toBeGreaterThan(0);
    expect(e.length).toBeLessThan(20);
    expect(store.get(STORAGE_KEY)!.length).toBeLessThan(1_200_000);
  });

  it('gives up cleanly when the quota is blown anyway', () => {
    signedInAs('a1');
    const cache = persistedCacheProvider();
    store.set(STORAGE_KEY, blob([['/api/old', { n: 0 }]]));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: (k: string) => void store.delete(k),
    });

    cache.set('/api/new', { data: { n: 1 } });
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    // Cleared rather than left holding a stale blob the next load would trust.
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('flushes when the app is backgrounded, not only on a polite close', () => {
    // iOS can discard a backgrounded PWA's web view without ever running
    // beforeunload, and "the cache is warm only if you closed the app properly"
    // is not a feature anybody would notice working.
    signedInAs('a1');
    persistedCacheProvider();
    expect(listeners).toContain('pagehide');
    expect(listeners).toContain('visibilitychange');
  });
});

describe('the cache Map itself', () => {
  it('is still a working Map through the write-tracking proxy', () => {
    signedInAs('a1');
    const cache = persistedCacheProvider() as unknown as Map<string, unknown>;

    cache.set('/a', { data: 1 });
    cache.set('/b', { data: 2 });
    // `size` in particular: it is a built-in getter that checks its receiver for
    // Map's internal slots, so a proxy that forwards `this` naively throws here.
    expect(cache.size).toBe(2);
    expect([...cache.keys()]).toEqual(['/a', '/b']);
    cache.delete('/a');
    expect(cache.size).toBe(1);
    expect(cache.get('/a')).toBeUndefined();
  });
});

describe('clearPersistedSWRCache', () => {
  it('removes the cache and nothing else', () => {
    store.set(STORAGE_KEY, blob([]));
    store.set('locale', 'he');

    clearPersistedSWRCache();

    expect(store.has(STORAGE_KEY)).toBe(false);
    expect(store.get('locale')).toBe('he');
  });

  it('is a no-op on the server rather than throwing', () => {
    vi.stubGlobal('window', undefined);
    expect(() => clearPersistedSWRCache()).not.toThrow();
  });
});
