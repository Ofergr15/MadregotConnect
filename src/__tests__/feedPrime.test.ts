import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }),
}));
vi.mock('@/lib/auth/silent-reauth', () => ({ trySilentReauth: async () => null }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [{ id: 'a' }], nextCursor: 'c1' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// The shell starts the feed's first page while it waits on /api/auth/me, and
// the feed screen picks it up when it mounts — the two requests overlap
// instead of running back to back.
describe('feed first-page prime', () => {
  it('hands the primed page over once, requested exactly once', async () => {
    const { primeFeedFirstPage, takePrimedFeedPage, FEED_PAGE_SIZE } = await import('@/lib/feed-client');
    primeFeedFirstPage();
    primeFeedFirstPage(); // a re-render while still waiting must not ask twice
    const page = takePrimedFeedPage();
    expect(await page).toEqual({ items: [{ id: 'a' }], nextCursor: 'c1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/feed?limit=${FEED_PAGE_SIZE}`);
    expect(takePrimedFeedPage()).toBeNull();
  });

  it('drops a stale prime rather than serving an old page', async () => {
    vi.useFakeTimers();
    const { primeFeedFirstPage, takePrimedFeedPage } = await import('@/lib/feed-client');
    primeFeedFirstPage();
    vi.advanceTimersByTime(16_000);
    expect(takePrimedFeedPage()).toBeNull();
  });

  it('a failed prime does not throw unhandled; the taker sees the error', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'inactive' }), { status: 403 }));
    const { primeFeedFirstPage, takePrimedFeedPage } = await import('@/lib/feed-client');
    primeFeedFirstPage();
    await expect(takePrimedFeedPage()).rejects.toThrow('inactive');
  });
});
