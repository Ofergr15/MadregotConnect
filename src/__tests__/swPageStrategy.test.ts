import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasStoredPage, preferStored } from '@/lib/sw-page-strategy';

/**
 * The four seconds nobody was getting anything for.
 *
 * `networkTimeoutSeconds: 4` on the page cache means "prefer a stored page over a
 * slow one". On a cold open there is no stored page, so those four seconds elapsed,
 * Workbox rejected, and the retry started the network leg again from zero — four
 * seconds of loss in front of a server measured at 26.5s from cold. And because the
 * page buckets are build-scoped, "cold" is what every athlete gets after every
 * deploy, plus 30 minutes after they last opened the app.
 *
 * These tests pin the decision: the timeout runs only when it has something to
 * choose between.
 */

const req = (url = 'https://www.madregot.app/feed') => new Request(url);

/** A Cache Storage stand-in holding one response per URL. */
function stubCaches(entries: Record<string, Response> | Error) {
  if (entries instanceof Error) {
    vi.stubGlobal('caches', {
      open: () => Promise.reject(entries),
    });
    return;
  }
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (request: Request) => entries[request.url],
    }),
  });
}

const storedAt = (when: number, body = 'stored') =>
  new Response(body, { headers: { date: new Date(when).toUTCString() } });

afterEach(() => vi.unstubAllGlobals());

describe('hasStoredPage', () => {
  it('is false for an empty bucket — the cold open the timeout cannot help', async () => {
    stubCaches({});
    expect(await hasStoredPage('pages--abc', req())).toBe(false);
  });

  it('is true for a fresh entry, which is what the timeout exists to serve', async () => {
    stubCaches({ 'https://www.madregot.app/feed': storedAt(Date.now() - 60_000) });
    expect(await hasStoredPage('pages--abc', req(), 1800)).toBe(true);
  });

  // The nastiest case, and the reason this is age-aware: `cache.match` finds the
  // entry, so a naive presence check says "timeout is worth it" — and then the
  // ExpirationPlugin refuses to serve it, four seconds later, having promised a
  // fallback that never existed.
  it('is false for an entry the ExpirationPlugin would refuse anyway', async () => {
    stubCaches({ 'https://www.madregot.app/feed': storedAt(Date.now() - 3600_000) });
    expect(await hasStoredPage('pages--abc', req(), 1800)).toBe(false);
  });

  it('trusts an entry whose age it cannot read', async () => {
    // No `date` header, or an unparseable one: unknown is not the same as old, and
    // discarding a usable page costs more than one wasted timeout.
    stubCaches({ 'https://www.madregot.app/feed': new Response('stored') });
    expect(await hasStoredPage('pages--abc', req(), 1800)).toBe(true);
    stubCaches({ 'https://www.madregot.app/feed': new Response('s', { headers: { date: 'soon' } }) });
    expect(await hasStoredPage('pages--abc', req(), 1800)).toBe(true);
  });

  it('trusts an entry that looks like it came from the future', async () => {
    // A phone with a skewed clock. Negative age, not old age.
    stubCaches({ 'https://www.madregot.app/feed': storedAt(Date.now() + 600_000) });
    expect(await hasStoredPage('pages--abc', req(), 1800)).toBe(true);
  });

  it('answers no when Cache Storage is unreachable, never throws', async () => {
    // A bucket we cannot read is not a fallback we can promise. Answering "no"
    // picks the patient path, which is the safe side of being wrong — and this runs
    // inside a fetch handler, so a throw here would fail the navigation itself.
    stubCaches(new Error('SecurityError'));
    await expect(hasStoredPage('pages--abc', req(), 1800)).resolves.toBe(false);
    vi.unstubAllGlobals();
    // Also the case where the API isn't there at all.
    await expect(hasStoredPage('pages--abc', req(), 1800)).resolves.toBe(false);
  });

  it('asks about the request it was given, not the bucket in general', async () => {
    stubCaches({ 'https://www.madregot.app/feed': storedAt(Date.now()) });
    expect(await hasStoredPage('pages--abc', req('https://www.madregot.app/feed'), 1800)).toBe(true);
    expect(await hasStoredPage('pages--abc', req('https://www.madregot.app/races'), 1800)).toBe(false);
  });
});

describe('preferStored', () => {
  const pair = (isStored: boolean) => {
    const stored = vi.fn(async () => new Response('timed'));
    const unstored = vi.fn(async () => new Response('patient'));
    return {
      stored,
      unstored,
      handler: preferStored<{ request: Request }>({
        stored: { handle: stored },
        unstored: { handle: unstored },
        isStored: async () => isStored,
      }),
    };
  };

  it('uses the timed strategy when a stored page can answer', async () => {
    const { handler, stored, unstored } = pair(true);
    expect(await (await handler.handle({ request: req() })).text()).toBe('timed');
    expect(stored).toHaveBeenCalledTimes(1);
    expect(unstored).not.toHaveBeenCalled();
  });

  // The fix, in one test: with an empty bucket nothing waits four seconds to
  // discover the bucket was empty.
  it('goes straight to the patient strategy when nothing is stored', async () => {
    const { handler, stored, unstored } = pair(false);
    expect(await (await handler.handle({ request: req() })).text()).toBe('patient');
    expect(unstored).toHaveBeenCalledTimes(1);
    expect(stored).not.toHaveBeenCalled();
  });

  it('passes the params through untouched', async () => {
    const request = req('https://www.madregot.app/dashboard/planner');
    const seen: Request[] = [];
    const handler = preferStored<{ request: Request }>({
      stored: { handle: async (p) => { seen.push(p.request); return new Response('x'); } },
      unstored: { handle: async (p) => { seen.push(p.request); return new Response('x'); } },
      isStored: async () => true,
    });
    await handler.handle({ request });
    expect(seen[0]).toBe(request);
  });

  it('lets a rejection from the chosen strategy travel, so the offline page still happens', async () => {
    const handler = preferStored<{ request: Request }>({
      stored: { handle: async () => new Response('unused') },
      unstored: { handle: async () => { throw new TypeError('Failed to fetch'); } },
      isStored: async () => false,
    });
    // withNetworkRetry sits outside this and the fallback outside that. Swallowing
    // here would strand a genuinely offline phone on a blank screen.
    await expect(handler.handle({ request: req() })).rejects.toThrow('Failed to fetch');
  });
});
