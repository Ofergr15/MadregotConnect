import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ apiHeaders: async () => ({}) }));

import { loadFeatures, resetFeatureCache } from '@/lib/features/use-feature';
import { FEATURES } from '@/lib/features/flags';

describe('web useFeature / loadFeatures', () => {
  beforeEach(() => { resetFeatureCache(); vi.unstubAllGlobals(); });

  it('web_feed_quiet exists and is default-off', () => {
    expect(FEATURES.web_feed_quiet.defaultEnabled).toBe(false);
  });

  it('returns the server map on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: { web_feed_quiet: true } }), { status: 200 })));
    expect((await loadFeatures()).web_feed_quiet).toBe(true);
  });

  it('fails closed on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    expect(await loadFeatures()).toEqual({});
  });

  it('fails closed on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadFeatures()).toEqual({});
  });

  it('shares one request across callers', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ features: {} }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await Promise.all([loadFeatures(), loadFeatures(), loadFeatures()]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
