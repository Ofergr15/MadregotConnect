// Task 184: weekly summary comparisons — my group vs the others, my trend vs my last four weeks,
// on the activity week (Monday–Sunday).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MIN_GROUP_RUNNERS, buildGroupStats, buildTrend, buildWeekCompare } from '@/lib/week-story/compare';

const WEEK = '2026-11-16'; // a Monday
const run = (athleteId: string, day: string, km: number) => ({ athleteId, day, km });

describe('buildTrend', () => {
  it('four weeks before + this week, oldest first; activity-week edges (Mon in, next Mon out)', () => {
    const t = buildTrend(WEEK, [
      { day: '2026-10-19', km: 40 }, { day: '2026-10-26', km: 40 }, { day: '2026-11-02', km: 40 }, { day: '2026-11-15', km: 40 },
      { day: '2026-11-16', km: 30 }, { day: '2026-11-22', km: 25 }, { day: '2026-11-23', km: 99 },
    ]);
    expect(t.weeks.map((w) => [w.weekStart, w.km])).toEqual([
      ['2026-10-19', 40], ['2026-10-26', 40], ['2026-11-02', 40], ['2026-11-09', 40], ['2026-11-16', 55],
    ]);
    expect(t).toMatchObject({ avg4Km: 40, deltaKm: 15, deltaPct: 38, direction: 'up' });
  });
  it('a zero week counts as zero; ±10% is steady; nothing before → nulls', () => {
    expect(buildTrend(WEEK, [{ day: '2026-11-09', km: 40 }, { day: '2026-11-16', km: 10 }])).toMatchObject({ avg4Km: 10, direction: 'steady', deltaPct: 0 });
    expect(buildTrend(WEEK, [{ day: '2026-11-09', km: 40 }, { day: '2026-11-16', km: 5 }])).toMatchObject({ direction: 'down' });
    expect(buildTrend(WEEK, [{ day: '2026-11-16', km: 5 }])).toMatchObject({ avg4Km: null, deltaPct: null, direction: null });
  });
});

describe('group stats', () => {
  const groups = [{ id: 'g1', name: 'Group 1' }, { id: 'g2', name: 'Group 2' }, { id: 'g3', name: 'Group 3' }];
  const memberGroup = new Map([
    ['me', 'g1'], ['a', 'g1'], ['b', 'g1'], ['c', 'g1'], ['rest', 'g1'],
    ['x', 'g2'], ['y', 'g2'], ['z', 'g2'],
    ['solo', 'g3'], ['duo', 'g3'],
  ]);
  const clubRuns = [
    run('me', '2026-11-17', 30), run('a', '2026-11-18', 50), run('b', '2026-11-19', 20), run('c', '2026-11-20', 40),
    run('x', '2026-11-17', 10), run('y', '2026-11-17', 12), run('z', '2026-11-22', 14),
    run('solo', '2026-11-17', 9), run('duo', '2026-11-17', 9),
    run('outsider', '2026-11-17', 300), run('a', '2026-11-15', 300),
  ];
  it('avg/median over runners only; outsiders and other weeks ignored; small groups withheld', () => {
    const { stats } = buildGroupStats(WEEK, clubRuns, memberGroup, groups);
    expect(stats).toEqual([
      { groupId: 'g1', name: 'Group 1', members: 5, runners: 4, avgKm: 35, medianKm: 35 },
      { groupId: 'g2', name: 'Group 2', members: 3, runners: 3, avgKm: 12, medianKm: 12 },
    ]);
    expect(MIN_GROUP_RUNNERS).toBe(3);
  });
  it("my place in my group, against its average; no teammate's name or km in the output", () => {
    const c = buildWeekCompare({ weekStart: WEEK, athleteId: 'me', myRuns: [{ day: '2026-11-17', km: 30 }], clubRuns, memberGroup, groups });
    expect(c.group).toMatchObject({ groupId: 'g1', myKm: 30, myRank: 3, runners: 4, vsAvgPct: -14 });
    expect(c.weekEnd).toBe('2026-11-22');
    expect(c.groups.map((g) => g.groupId)).toEqual(['g1', 'g2']);
    expect(JSON.stringify(c)).not.toMatch(/"(a|b|c|x|y|z)"/);
  });
  it('did not run → no rank; group too small → group null', () => {
    const c = buildWeekCompare({ weekStart: WEEK, athleteId: 'rest', myRuns: [], clubRuns, memberGroup, groups });
    expect(c.group).toMatchObject({ myKm: 0, myRank: null, vsAvgPct: -100 });
    expect(buildWeekCompare({ weekStart: WEEK, athleteId: 'solo', myRuns: [], clubRuns, memberGroup, groups }).group).toBeNull();
  });
});

// ── route ────────────────────────────────────────────────────────────────────────────────────
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const loadWeekCompare = vi.fn(async (_db: unknown, id: string, w: string) => ({ who: id, weekStart: w }));
vi.mock('@/lib/week-story/compare-server', () => ({ loadWeekCompare: (...a: [unknown, string, string]) => loadWeekCompare(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const route = await import('@/app/api/week-story/compare/route');
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false, role: 'runner', ...c } });
const get = (q = '') => route.GET(new Request(`http://x/api/week-story/compare?${q}`));

beforeEach(() => { loadWeekCompare.mockClear(); as({}); });

describe('GET /api/week-story/compare', () => {
  it('self; default = the last closed activity week (a Monday)', async () => {
    const body = await (await get()).json();
    expect(body.compare.who).toBe('me');
    expect(new Date(`${body.compare.weekStart}T12:00:00Z`).getUTCDay()).toBe(1);
  });
  it("a member can't read someone else's; staff can", async () => {
    await get('athleteId=other&weekStart=2026-11-16');
    expect(loadWeekCompare.mock.calls[0][1]).toBe('me');
    as({ isStaff: true });
    await get('athleteId=other&weekStart=2026-11-16');
    expect(loadWeekCompare.mock.calls[1][1]).toBe('other');
  });
  it('weekStart must be a past Monday', async () => {
    expect((await get('weekStart=2026-11-15')).status).toBe(400);
    expect((await get('weekStart=nope')).status).toBe(400);
    expect((await get('weekStart=2099-01-05')).status).toBe(400);
    expect(loadWeekCompare).not.toHaveBeenCalled();
  });
  it('unsigned → the gate answers; no athlete → null', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    expect((await get()).status).toBe(401);
    as({ athleteId: null });
    expect(await (await get()).json()).toEqual({ compare: null });
  });
});
