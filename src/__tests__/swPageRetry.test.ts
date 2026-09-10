import { describe, it, expect, vi } from 'vitest';
import { withNetworkRetry } from '@/lib/sw-page-retry';

/**
 * "No internet connection", shown to a phone that had one.
 *
 * The page cache is a NetworkFirst with a four-second timeout. That timeout is a
 * preference for a STORED page — but with nothing stored (cold open, or the
 * 30-minute expiry already passed) Workbox has nothing to hand back and rejects,
 * and a rejected document request is exactly what Serwist turns into
 * /offline.html. Measured the same day the reports came in: a cold serverless
 * start answered in 26.5 seconds. Four seconds is not a verdict about the
 * network, and these tests are what stop it being treated as one.
 */

const req = (url = 'https://www.madregot.app/feed') => new Request(url);

describe('withNetworkRetry', () => {
  it('passes a successful response straight through', async () => {
    const doFetch = vi.fn();
    const wrapped = withNetworkRetry(
      { handle: async () => new Response('cached', { status: 200 }) },
      doFetch,
    );
    const res = await wrapped.handle({ request: req() });
    expect(await res.text()).toBe('cached');
    // The whole point of the strategy is that the fast path stays untouched.
    expect(doFetch).not.toHaveBeenCalled();
  });

  // The bug, in one test: the strategy came back empty-handed and the user was
  // told they were offline.
  it('asks the network again when the strategy comes back empty-handed', async () => {
    const doFetch = vi.fn(async () => new Response('live', { status: 200 }));
    const wrapped = withNetworkRetry(
      { handle: async () => { throw new Error('no-response'); } },
      doFetch,
    );
    const res = await wrapped.handle({ request: req() });
    expect(await res.text()).toBe('live');
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('re-issues the same request, not a new one', async () => {
    const doFetch = vi.fn(async (r: Request) => new Response(r.url));
    const request = req('https://www.madregot.app/dashboard/planner');
    const wrapped = withNetworkRetry(
      { handle: async () => { throw new Error('timeout'); } },
      doFetch,
    );
    await wrapped.handle({ request });
    expect(doFetch.mock.calls[0][0]).toBe(request);
  });

  // A 4xx/5xx is a real answer from a reachable server. Re-requesting it would
  // double every error page and could replay a non-idempotent navigation.
  it('does not retry a server error, which is an answer', async () => {
    const doFetch = vi.fn();
    const wrapped = withNetworkRetry(
      { handle: async () => new Response('boom', { status: 500 }) },
      doFetch,
    );
    expect((await wrapped.handle({ request: req() })).status).toBe(500);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('does not retry a 404 either', async () => {
    const doFetch = vi.fn();
    const wrapped = withNetworkRetry(
      { handle: async () => new Response('nope', { status: 404 }) },
      doFetch,
    );
    expect((await wrapped.handle({ request: req() })).status).toBe(404);
    expect(doFetch).not.toHaveBeenCalled();
  });

  // A phone in a lift really is offline. The retry must not swallow that — the
  // rejection has to keep travelling, because it is what produces the offline
  // page the user genuinely needs.
  it('still fails when the network is genuinely gone', async () => {
    const wrapped = withNetworkRetry(
      { handle: async () => { throw new Error('timeout'); } },
      async () => { throw new TypeError('Failed to fetch'); },
    );
    await expect(wrapped.handle({ request: req() })).rejects.toThrow('Failed to fetch');
  });

  it('retries exactly once, never in a loop', async () => {
    let calls = 0;
    const doFetch = vi.fn(async () => { calls++; throw new Error('down'); });
    const wrapped = withNetworkRetry(
      { handle: async () => { throw new Error('timeout'); } },
      doFetch,
    );
    await expect(wrapped.handle({ request: req() })).rejects.toThrow('down');
    expect(calls).toBe(1);
  });

  // The retry deliberately has no timeout of its own: it exists to outwait a
  // cold start, so a slow answer is the success case, not a second failure.
  it('waits for a slow answer instead of giving up on it', async () => {
    const wrapped = withNetworkRetry(
      { handle: async () => { throw new Error('timeout after 4s'); } },
      async () => {
        await new Promise((r) => setTimeout(r, 25));
        return new Response('slow but fine');
      },
    );
    expect(await (await wrapped.handle({ request: req() })).text()).toBe('slow but fine');
  });
});
