import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/lib/version';
import type { FeedActivity, FeedItem } from '@/lib/feed/project';

/**
 * The saved first feed page (lib/feed/feed-cache) is what lets a returning
 * member see the feed the moment the app opens. It holds their club's runs, so
 * the failures that matter are the quiet ones: showing it to the next person on
 * a shared phone, or handing a card renderer an item from another release.
 */
const KEY = 'mc_feed_page_v1';
const store = new Map<string, string>();
const item = (id: string, pad = 0) => ({ id, type: 'run', note: 'x'.repeat(pad) }) as never;

/** Real-shaped items, typed so a new required field breaks this fixture too. */
function postItem(id: string): FeedItem {
  return {
    id, type: 'post', author: { athleteId: 'a2', name: 'Dana', avatarUrl: null, groupName: 'דבוקה 1' },
    body: 'שלום', media: [{ path: 'p/1.jpg', url: 'https://x/1.jpg', w: 1080, h: 1350 }], payload: null,
    occurredAt: '2026-10-16T06:00:00Z', likeCount: 1, commentCount: 1, likedByMe: false,
    likePreview: [{ athleteId: 'a3', name: 'Tal', avatarUrl: null }],
    commentPreview: [{ id: 'c1', itemId: id, body: 'יפה', createdAt: '2026-10-16T06:05:00Z', author: { athleteId: 'a3', name: 'Tal', avatarUrl: null }, canDelete: false }],
    canDelete: false, activity: null,
  };
}
function runItem(id: string): FeedItem {
  const activity: FeedActivity = {
    id: `act-${id}`, athleteId: 'a1', garminActivityId: null, activityName: 'ריצה', activityType: 'running',
    startTime: '2026-10-16T06:00:00Z', distance: 10_000, duration: 3000, movingDuration: null, averagePace: 300,
    averageHr: null, maxHr: null, calories: null, elevationGain: null, locationName: null, perceivedRpe: null,
    perceivedFeel: null, routePreview: [{ lat: 32, lng: 34 }], hasRoute: true, paceBands: [300, 300],
    planVerdict: { fake: true } as never,
  };
  return { ...postItem(id), type: 'activity', body: null, media: [], activity };
}

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

  it('drops a page from another release whose items no longer fit the types', async () => {
    store.set(KEY, JSON.stringify({ v: '0.0.1', id: 'a1|', at: Date.now(), items: [item('f1')], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(APP_VERSION).not.toBe('0.0.1');
    expect(readSavedFeedPage()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  // A release a day made every first open of the day cold (lab 2026-10-16). A page
  // whose items still fit is shown across the release, minus what isn't checked.
  it('keeps a well-shaped page across a release, without its plan badges or cursor', async () => {
    store.set(KEY, JSON.stringify({ v: '0.0.1', id: 'a1|', at: Date.now(), items: [runItem('f1'), postItem('f2')], cursor: 'c2' }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    const got = readSavedFeedPage();
    expect(got?.cursor).toBeNull();
    expect(got?.items.map(i => i.id)).toEqual(['f1', 'f2']);
    expect(got?.items[0].activity?.planVerdict).toBeNull();
    expect(got?.items[0].activity?.distance).toBe(10_000);
  });

  it('keeps the cursor and the badges within the same release', async () => {
    store.set(KEY, JSON.stringify({ v: APP_VERSION, id: 'a1|', at: Date.now(), items: [runItem('f1')], cursor: 'c2' }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    const got = readSavedFeedPage();
    expect(got?.cursor).toBe('c2');
    expect(got?.items[0].activity?.planVerdict).toEqual({ fake: true });
  });

  it('drops the whole page when one item is off, rather than showing a gap', async () => {
    const bad = { ...runItem('f2'), activity: { ...runItem('f2').activity!, distance: '10 km' } };
    store.set(KEY, JSON.stringify({ v: '0.0.1', id: 'a1|', at: Date.now(), items: [runItem('f1'), bad], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(readSavedFeedPage()).toBeNull();
  });

  it('drops a page saved under another FEED_SHAPE', async () => {
    store.set(KEY, JSON.stringify({ v: APP_VERSION, shape: 999, id: 'a1|', at: Date.now(), items: [runItem('f1')], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(readSavedFeedPage()).toBeNull();
  });

  it('reads a page the previous release saved before it stamped a shape', async () => {
    store.set(KEY, JSON.stringify({ v: '0.0.1', id: 'a1|', at: Date.now(), items: [runItem('f1')], cursor: null }));
    const { readSavedFeedPage } = await import('@/lib/feed/feed-cache');
    expect(readSavedFeedPage()?.items).toHaveLength(1);
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
