import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildProfileHeadline, cachedHeadline, invalidateHeadline, HEADLINE_TTL_MS } from '@/lib/athletes/profile-headline';

// Wednesday 2026-11-25 12:00 Israel. Activity week = Mon 11-23 … Sun 11-29.
const NOW = new Date('2026-11-25T10:00:00Z');
const run = (start_time: string, km: number, activity_type = 'running') => ({ start_time, distance: km * 1000, duration: km * 300, activity_type });

describe('buildProfileHeadline', () => {
  it('week is the Monday activity week, not the Sunday plan week', () => {
    const h = buildProfileHeadline([
      run('2026-11-22T07:00:00+00:00', 20), // Sunday: plan week yes, activity week no
      run('2026-11-23T07:00:00+00:00', 10), // Monday
      run('2026-11-25T06:00:00+00:00', 8),
    ], NOW);
    expect(h.weekStart).toBe('2026-11-23');
    expect(h.weekKm).toBe(18);
    expect(h.weekRuns).toBe(2);
  });
  it('month and year read the wall-clock prefix (00:30 on the 1st is the new month)', () => {
    const h = buildProfileHeadline([
      run('2026-11-01T00:30:00+00:00', 5),
      run('2026-10-31T23:30:00+00:00', 7),
      run('2025-12-31T23:00:00+00:00', 9),
    ], NOW);
    expect(h.monthKm).toBe(5);
    expect(h.monthRuns).toBe(1);
    expect(h.yearKm).toBe(12);
    expect(h.yearRuns).toBe(2);
  });
  it('streak counts consecutive activity weeks and ignores non-runs', () => {
    const h = buildProfileHeadline([
      run('2026-11-24T06:00:00+00:00', 5),
      run('2026-11-17T06:00:00+00:00', 5),
      run('2026-11-10T06:00:00+00:00', 5),
      run('2026-11-03T06:00:00+00:00', 40, 'cycling'),
      run('2026-10-27T06:00:00+00:00', 5),
    ], NOW);
    expect(h.streakWeeks).toBe(3);
  });
  it('an empty history is all zeros', () => {
    expect(buildProfileHeadline([], NOW)).toMatchObject({ weekKm: 0, monthKm: 0, yearKm: 0, streakWeeks: 0 });
  });
});

describe('cachedHeadline', () => {
  beforeEach(() => invalidateHeadline());
  it('serves from cache within the TTL and reloads after', async () => {
    const v = buildProfileHeadline([], NOW);
    const load = vi.fn(async () => v);
    expect((await cachedHeadline('a', load, 1000)).hit).toBe(false);
    expect((await cachedHeadline('a', load, 1000 + HEADLINE_TTL_MS - 1)).hit).toBe(true);
    expect((await cachedHeadline('a', load, 1000 + HEADLINE_TTL_MS)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('is per athlete and can be invalidated', async () => {
    const load = vi.fn(async () => buildProfileHeadline([], NOW));
    await cachedHeadline('a', load, 0);
    await cachedHeadline('b', load, 0);
    invalidateHeadline('a');
    expect((await cachedHeadline('a', load, 1)).hit).toBe(false);
    expect((await cachedHeadline('b', load, 1)).hit).toBe(true);
  });
});

describe('GET /api/athletes/[id]/headline', () => {
  let hidden = false;
  beforeEach(() => {
    vi.resetModules();
    hidden = false;
    vi.doMock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'me', isStaff: false } }) }));
    vi.doMock('@/lib/athletes/test-accounts', () => ({ hiddenFromCaller: async () => hidden }));
    vi.doMock('@/lib/supabase/paginate', () => ({ fetchAllRows: async () => [run('2026-11-24T06:00:00+00:00', 10)] }));
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
  });
  const get = async (id: string) => (await import('@/app/api/athletes/[id]/headline/route')).GET(new Request('http://x'), { params: Promise.resolve({ id }) });

  it('a pending runner is 404 to other members, even when cached', async () => {
    expect((await get('x1')).status).toBe(200);
    hidden = true;
    expect((await get('x1')).status).toBe(404);
  });
  it('returns only the headline numbers, private', async () => {
    const res = await get('x2');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['monthKm', 'monthRuns', 'streakWeeks', 'weekKm', 'weekRuns', 'weekStart', 'yearKm', 'yearRuns']);
  });
});
