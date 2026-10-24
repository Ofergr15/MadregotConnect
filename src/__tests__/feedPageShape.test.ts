import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/bearer-headers', () => ({ bearerHeaders: async () => ({}), accessToken: async () => 'tok' }));

/**
 * #143 / #146: the feed crashed on `items.length` when /api/feed answered 200 with something
 * that wasn't the API's JSON — `parse` turned it into {} and the page arrived without a list.
 */
describe('fetchFeed never hands over a page without a list', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: string, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));

  it('throws on a 200 that is not JSON', async () => {
    answer('<html>offline</html>');
    const { fetchFeed } = await import('@/lib/feed-client');
    await expect(fetchFeed(null, 20)).rejects.toThrow('no feed page');
  });
  it('throws on JSON without items', async () => {
    answer('{}');
    const { fetchFeed } = await import('@/lib/feed-client');
    await expect(fetchFeed(null, 20)).rejects.toThrow('no feed page');
  });
  it('passes a real page through', async () => {
    answer(JSON.stringify({ items: [{ id: 'a' }], nextCursor: 'c' }));
    const { fetchFeed } = await import('@/lib/feed-client');
    await expect(fetchFeed(null, 20)).resolves.toEqual({ items: [{ id: 'a' }], nextCursor: 'c' });
  });
});
