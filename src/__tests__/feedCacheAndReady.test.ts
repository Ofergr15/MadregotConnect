import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/lib/version';

/**
 * The saved first feed page (lib/feed/feed-cache) is what lets a returning
 * member see the feed the moment the app opens. It holds their club's runs, so
 * the failures that matter are the quiet ones: showing it to the next person on
 * a shared phone, or handing a card renderer an item from another release.
 */
const KEY = 'mc_feed_page_v1';
const store = new Map<string, string>();
const item = (id: string, pad = 0) => ({ id, type: 'run', note: 'x'.repeat(pad) }) as never;

beforeEach(() => {
  vi.resetModules();
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  store.set('athlete_id', 'a1');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('saved feed page', () => {
  it('round-trips for the same member and release', async () => {
    const { saveFeedPage, readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    saveFeedPage([item('f1'), item('f2')], 'c2');
    expect(readSavedFeedPage()).toEqual({ items: [item('f1'), item('f2')], cursor: 'c2' });
  });

  it('never shows one member\'s feed to the next person on the device', async () => {
    const { saveFeedPage, readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    saveFeedPage([item('f1')], null);
    store.set('athlete_id', 'someone-else');
    expect(readSavedFeedPage()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('drops a page saved by another release', async () => {
    store.set(KEY, JSON.stringify({ v: '0.0.1', id: 'a1|', at: Date.now(), items: [item('f1')], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(APP_VERSION).not.toBe('0.0.1');
    expect(readSavedFeedPage()).toBeNull();
  });

  it('drops a page older than a week', async () => {
    store.set(KEY, JSON.stringify({ v: APP_VERSION, id: 'a1|', at: Date.now() - 8 * 86_400_000, items: [item('f1')], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(readSavedFeedPage()).toBeNull();
  });

  it('saves nothing when nobody is signed in', async () => {
    store.delete('athlete_id');
    const { saveFeedPage } = await import('@/lib/feed/feed-cache');
    saveFeedPage([item('f1')], null);
    expect(store.has(KEY)).toBe(false);
  });

  it('trims an oversized page to fit, without a cursor it can no longer honour', async () => {
    const { saveFeedPage, readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    const big = Array.from({ length: 20 }, (_, i) => item(`f${i}`, 30_000));
    saveFeedPage(big, 'c20');
    const saved = readSavedFeedPage();
    expect(saved!.items.length).toBeLessThan(20);
    expect(saved!.items[0]).toEqual(big[0]);
    expect(saved!.cursor).toBeNull();
    expect(store.get(KEY)!.length).toBeLessThanOrEqual(256 * 1024);
  });

  it('is cleared with the identity keys on sign-out', async () => {
    const { saveFeedPage } = await import('@/lib/feed/feed-cache');
    saveFeedPage([item('f1')], null);
    const { clearSavedFeedPage } = await import('@/lib/feed/feed-cache');
    clearSavedFeedPage();
    expect(store.has(KEY)).toBe(false);
    const src = (await import('node:fs')).readFileSync(new URL('../lib/auth/identity-keys.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/clearSavedFeedPage\(\)/);
  });
});

describe('app-ready signal', () => {
  it('fires listeners once, and a late listener still hears it', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const { markAppReady, onAppReady } = await import('@/lib/app-ready');
    const early = vi.fn();
    onAppReady(early);
    markAppReady();
    markAppReady();
    expect(early).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    onAppReady(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
