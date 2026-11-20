import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/athletes/volume-history: a failed plan-target read is SAID (targetCoverage 'unavailable'), never drawn as
 * "no target that week"; and fetchWeekTargets itself throws on a read error instead of returning an empty map.
 */
const h = vi.hoisted(() => ({ targetsFail: false }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'a1', isStaff: false, isSuperUser: false } }), mayActFor: () => true }));
vi.mock('@/lib/athletes/week-pref', () => ({ readWeekStartDay: async () => 1 }));
vi.mock('@/lib/athletes/weekly-volume', () => ({
  fetchWeeklyVolume: async () => ({ weeks: ['2026-11-09', '2026-11-16'],
    byAthlete: new Map([['a1', [{ weekStart: '2026-11-09', meters: 120000, runs: 6, seconds: 36000 }, { weekStart: '2026-11-16', meters: 80000, runs: 4, seconds: 24000 }]]]) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => {
    const b: any = {}; b.select = () => b; b.eq = () => b;
    b.in = async () => (h.targetsFail ? { data: null, error: { message: 'boom' } }
      : { data: [{ week_start_date: '2026-11-08', status: 'pushed', parsed_workouts: { group1: { workouts: [{ dayOfWeek: 0, name: 'x', distanceMinKm: 100, distanceMaxKm: 120, steps: [] }] }, group2: { workouts: [] }, group3: { workouts: [] } } }], error: null });
    return b;
  } }),
}));
const { GET } = await import('@/app/api/athletes/volume-history/route');
const { fetchWeekTargets, WeekTargetsUnavailable } = await import('@/lib/plans/week-target-history');
const get = async (q = '') => (await GET(new Request(`http://x/api/athletes/volume-history?athleteId=a1${q}`))).json();

beforeEach(() => { h.targetsFail = false; });

describe('volume-history target coverage', () => {
  it('targets read → included, and the week with a plan carries its band', async () => {
    const b = await get();
    expect(b.targetCoverage).toBe('included');
    expect(b.series.find((s: { weekStart: string }) => s.weekStart === '2026-11-09').target).toMatchObject({ min: 100, max: 120 });
  });
  it('targets read FAILS → 200, targetCoverage unavailable, no band anywhere, the actual km still served', async () => {
    h.targetsFail = true;
    const b = await get();
    expect(b.targetCoverage).toBe('unavailable');
    expect(b.series.every((s: { target?: unknown }) => s.target === undefined)).toBe(true);
    expect(b.series.map((s: { km: number }) => s.km)).toEqual([120, 80]);
  });
  it('month granularity → not_applicable (a month has no target of its own)', async () => {
    expect((await get('&granularity=month')).targetCoverage).toBe('not_applicable');
  });
  it('fetchWeekTargets throws WeekTargetsUnavailable on a read error (not an empty map)', async () => {
    const client = { from: () => { const b: any = {}; b.select = () => b; b.eq = () => b; b.in = async () => ({ data: null, error: { message: 'boom' } }); return b; } };
    await expect(fetchWeekTargets(client, 'coach', ['2026-11-08'])).rejects.toBeInstanceOf(WeekTargetsUnavailable);
  });
});
