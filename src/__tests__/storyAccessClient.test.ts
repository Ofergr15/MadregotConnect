import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiHeaders: async () => ({}) }));
const { fetchStoryAccess } = await import('@/lib/stories/client');
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
afterEach(() => vi.unstubAllGlobals());

describe('fetchStoryAccess', () => {
  it('a 404 (non-tester) is closed', async () => {
    respond(404, { allowed: false });
    expect((await fetchStoryAccess('weekly')).allowed).toBe(false);
  });
  it('a tester is open, with the badge', async () => {
    respond(200, { allowed: true, tester: true });
    expect(await fetchStoryAccess('weekly')).toEqual({ allowed: true, tester: true, preview: false, viewingAs: false });
  });
  it('a network error is closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await fetchStoryAccess('weekly')).allowed).toBe(false);
  });
  it('a 200 without allowed:true is closed', async () => {
    respond(200, {});
    expect((await fetchStoryAccess('weekly')).allowed).toBe(false);
  });
});

describe('showTesterBar', async () => {
  const { showTesterBar } = await import('@/lib/stories/client');
  it('only for a tester who is not being viewed-as', () => {
    expect(showTesterBar({ allowed: true, tester: true, preview: false })).toBe(true);
    expect(showTesterBar({ allowed: true, tester: true, preview: false, viewingAs: true })).toBe(false);
    expect(showTesterBar({ allowed: true, tester: false, preview: false })).toBe(false);
    expect(showTesterBar(null)).toBe(false);
  });
});
