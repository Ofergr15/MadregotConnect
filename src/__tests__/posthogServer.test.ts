import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAppOpens } from '@/lib/analytics/posthog-server';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('fetchAppOpens', () => {
  it('is null without a personal API key, and never calls PostHog', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchAppOpens()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads athlete/day pairs from the EU project by default', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test');
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [['a1', '2026-09-21'], [null, '2026-09-21'], ['a2', '2026-09-22']],
    })));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchAppOpens()).toEqual([
      { athleteId: 'a1', day: '2026-09-21' },
      { athleteId: 'a2', day: '2026-09-22' },
    ]);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://eu.posthog.com/api/projects/109306/query/');
  });

  it('is null when PostHog errors, so the admin home still renders', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    expect(await fetchAppOpens()).toBeNull();
  });
});
