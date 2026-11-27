// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

/** Coverage sweep (task 14): pure / client-state modules that had 0% line coverage. */

describe('photos/crop cropFace', () => {
  it('pads the face box by 25%, clamps to the image and caps the long edge at 512', async () => {
    const { cropFace } = await import('@/lib/photos/crop');
    const img = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const out = await cropFace(img, { left: 0.4, top: 0.4, width: 0.2, height: 0.2 } as never);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    // face 400x200 px, pad 100 → 600x400 crop, scaled inside 512.
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(341);
  });
  it('clamps a face touching the corner and never enlarges a small crop', async () => {
    const { cropFace } = await import('@/lib/photos/crop');
    const img = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } }).png().toBuffer();
    const meta = await sharp(await cropFace(img, { left: 0, top: 0, width: 0.25, height: 0.25 } as never)).metadata();
    expect([meta.width, meta.height]).toEqual([63, 63]);
  });
  it('throws on bytes that are not an image', async () => {
    const { cropFace } = await import('@/lib/photos/crop');
    await expect(cropFace(Buffer.from('nope'), { left: 0, top: 0, width: 1, height: 1 } as never)).rejects.toThrow();
  });
});

describe('birthday-year storyVariant', () => {
  const stats = (over: Record<string, unknown> = {}) => ({
    moment: null, streak: null, km: 0, bests: [], longest: null, runDates: [], totalDays: 365, elevM: 0, ...over,
  }) as never;

  it('is deterministic per athlete + birthday and varies across athletes', async () => {
    const { storyVariant, THEMES } = await import('@/lib/birthday-year/variant');
    const a = storyVariant('ath-1', '1990-05-01', stats());
    const b = storyVariant('ath-1', '1990-05-01', stats());
    expect(a.theme).toEqual(b.theme);
    expect(a.backgrounds).toEqual(b.backgrounds);
    expect(THEMES).toContain(a.theme);
    const themes = new Set(Array.from({ length: 30 }, (_, i) => storyVariant(`ath-${i}`, '1990-05-01', stats()).theme.key));
    expect(themes.size).toBeGreaterThan(1);
  });
  it('leads with the two strongest slides and keeps all eight exactly once', async () => {
    const { storyVariant } = await import('@/lib/birthday-year/variant');
    const v = storyVariant('x', '2000-01-01', stats({ moment: { k: 1 }, streak: { days: 40 } }));
    expect(v.order.slice(0, 2)).toEqual(['moment', 'streak']);
    expect([...v.order].sort()).toEqual(['climb', 'days', 'km', 'long', 'moment', 'prs', 'rhythm', 'streak']);
    const w = storyVariant('x', '2000-01-01', stats({ bests: [1, 2, 3, 4, 5, 6] }));
    expect(w.order[0]).toBe('prs');
  });
  it('fills every photo slot and pick() stays in range and stable', async () => {
    const { storyVariant, CLUB_BACKGROUNDS } = await import('@/lib/birthday-year/variant');
    const v = storyVariant('y', '1985-12-31', stats());
    expect(Object.keys(v.backgrounds)).toHaveLength(8);
    for (const bg of Object.values(v.backgrounds)) expect(CLUB_BACKGROUNDS).toContain(bg);
    expect(new Set(Object.values(v.backgrounds)).size).toBe(8);
    const p = v.pick('headline', 5);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(5);
    expect(v.pick('headline', 5)).toBe(p);
  });
});

describe('feed/scope-store', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('defaults to all/no squad and ignores a corrupt stored value', async () => {
    localStorage.setItem('mc:feedScope', '{bad json');
    const m = await import('@/lib/feed/scope-store');
    expect(m.getFeedScope()).toEqual({ kind: 'all', squad: null });
    expect(m.isDefaultScope(m.getFeedScope())).toBe(true);
  });
  it('restores a valid stored scope and rejects an unknown kind', async () => {
    localStorage.setItem('mc:feedScope', JSON.stringify({ kind: 'runs', squad: 'g1' }));
    expect((await import('@/lib/feed/scope-store')).getFeedScope()).toEqual({ kind: 'runs', squad: 'g1' });
    vi.resetModules();
    localStorage.setItem('mc:feedScope', JSON.stringify({ kind: 'weird', squad: 5 }));
    expect((await import('@/lib/feed/scope-store')).getFeedScope()).toEqual({ kind: 'all', squad: null });
  });
  it('set persists, merges, and reset returns to default', async () => {
    const m = await import('@/lib/feed/scope-store');
    m.setFeedScope({ kind: 'social' });
    m.setFeedScope({ squad: 'g2' });
    expect(m.getFeedScope()).toEqual({ kind: 'social', squad: 'g2' });
    expect(JSON.parse(localStorage.getItem('mc:feedScope')!)).toEqual({ kind: 'social', squad: 'g2' });
    expect(m.isDefaultScope(m.getFeedScope())).toBe(false);
    m.resetFeedScope();
    expect(m.isDefaultScope(m.getFeedScope())).toBe(true);
  });
});

describe('feed/scope-cache', () => {
  const fetchFeed = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    fetchFeed.mockReset();
    vi.doMock('@/lib/feed-client', () => ({ FEED_PAGE_SIZE: 20, fetchFeed: (...a: unknown[]) => fetchFeed(...a) }));
  });

  it('maps a kind to its feed types and keys scopes by kind + squad', async () => {
    const m = await import('@/lib/feed/scope-cache');
    expect(m.KIND_TYPES.runs).toEqual(['activity']);
    expect(m.scopeKey('all', null)).toBe('all|');
    expect(m.scopeKey('runs', 'g')).toBe('runs|g');
  });
  it('remember / cached round-trip', async () => {
    const m = await import('@/lib/feed/scope-cache');
    expect(m.cachedScope('all', null)).toBeNull();
    m.rememberScope('all', null, [{ id: 'i' }] as never, 'c1');
    expect(m.cachedScope('all', null)).toMatchObject({ items: [{ id: 'i' }], cursor: 'c1' });
  });
  it('dedupes concurrent loads and caches the result', async () => {
    let resolve!: (v: unknown) => void;
    fetchFeed.mockReturnValue(new Promise((r) => { resolve = r; }));
    const m = await import('@/lib/feed/scope-cache');
    const p1 = m.loadScope('social', 'g');
    const p2 = m.loadScope('social', 'g');
    expect(p1).toBe(p2);
    expect(fetchFeed).toHaveBeenCalledWith(null, 20, m.KIND_TYPES.social, 'g');
    resolve({ items: [{ id: 'a' }], nextCursor: 'n' });
    expect((await p1).cursor).toBe('n');
    expect(m.cachedScope('social', 'g')?.items).toEqual([{ id: 'a' }]);
  });
  it('prefetch skips fresh scopes and swallows failures', async () => {
    fetchFeed.mockRejectedValue(new Error('offline'));
    const m = await import('@/lib/feed/scope-cache');
    m.rememberScope('all', null, [], null);
    m.prefetchScopes([{ kind: 'all', squad: null }, { kind: 'runs', squad: null }]);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed.mock.calls[0][2]).toEqual(['activity']);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('analytics/posthog', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

  it('resolves null without a project token and never calls back', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', '');
    vi.doMock('@/lib/view-as-person', () => ({ isViewingPerson: () => false }));
    const m = await import('@/lib/analytics/posthog');
    expect(await m.loadPostHog()).toBeNull();
    const fn = vi.fn();
    m.withPostHog(fn);
    m.withLoadedPostHog(fn);
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).not.toHaveBeenCalled();
  });
  it('stays off while staff view the app as another person', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'tok');
    vi.doMock('@/lib/view-as-person', () => ({ isViewingPerson: () => true }));
    expect(await (await import('@/lib/analytics/posthog')).loadPostHog()).toBeNull();
  });
  it('initialises once with masked inputs and hands the instance out', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'tok');
    vi.doMock('@/lib/view-as-person', () => ({ isViewingPerson: () => false }));
    const init = vi.fn();
    vi.doMock('posthog-js', () => ({ default: { init } }));
    const m = await import('@/lib/analytics/posthog');
    const ph = await m.loadPostHog();
    expect(ph).not.toBeNull();
    await m.loadPostHog();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toBe('tok');
    expect(init.mock.calls[0][1].session_recording.maskAllInputs).toBe(true);
    const fn = vi.fn();
    m.withLoadedPostHog(fn);
    expect(fn).toHaveBeenCalledWith(ph);
  });
});
