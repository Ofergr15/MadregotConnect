import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import { weekStartOf, type LoadRow } from '@/lib/academy/pmc';
import { buildReadinessInputs } from '@/lib/academy/readiness-board';
import type { ReadinessRead } from '@/lib/academy/readiness-server';

/**
 * GET /api/academy/readiness — C1 (every trainee) and C2 (one trainee).
 *
 * What only the route can get wrong: C1 is staff-only and scoped like the coach tools (a
 * coach sees their own trainees, nobody else's), C2 is on the 1:1 line (`mayCoach`) and
 * not the trainee's own view, the projection prices THIS week's rest and NEXT week, and
 * the pace suggestion comes from the coach tools with the readiness already read.
 */

const israelDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const TODAY = israelDay();

const resolveVerifiedCaller = vi.fn();
const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r),
  requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id),
}));
// Coach C1 has Yoav and Shahar; coach C2 has Michal. The manager sees everyone.
const PAIRS: Record<string, string[]> = { c1: ['yoav', 'shahar'], c2: ['michal'] };
vi.mock('@/lib/academy/pairing-server', () => ({
  visibleTraineeIds: async (c: { athleteId: string; isManager?: boolean }, req: Request) =>
    (c.isManager && new URL(req.url).searchParams.get('scope') !== 'coach' ? null : new Set(PAIRS[c.athleteId] ?? [])),
  mayCoach: async (c: { athleteId: string; isManager?: boolean }, id: string) => c.athleteId === id || !!c.isManager || (PAIRS[c.athleteId] ?? []).includes(id),
}));
vi.mock('@/lib/academy/book-server', () => ({ allAcademyTraineeIds: async () => ['yoav', 'shahar', 'michal'] }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const steady = (load: number, days = 120): LoadRow[] =>
  Array.from({ length: days }, (_, i) => ({ date: shiftDate(TODAY, -days + i), load, source: 'pace' as const }));
const highRhr = Array.from({ length: 31 }, (_, i) => ({ date: shiftDate(TODAY, i - 30), resting_hr: i >= 28 ? 60 : 46 + (i % 5) }));
function read(name: string, rows: LoadRow[], extra: Partial<Parameters<typeof buildReadinessInputs>[0]> = {}): ReadinessRead {
  const { inputs, series } = buildReadinessInputs({ rows, nights: [], feedback: [], today: TODAY, ...extra });
  return { inputs, series, rows: rows.map(r => ({ ...r, athleteId: name, activityId: `${name}${r.date}` })), name, gender: 'male', isAcademy: true, active: true };
}
const READS: Record<string, ReadinessRead> = {
  // A huge last week on a modest base, and three high mornings: very tired + RHR.
  yoav: read('Yoav Cohen', [...steady(40, 113), ...Array.from({ length: 7 }, (_, i) => ({ date: shiftDate(TODAY, -7 + i), load: 260, source: 'pace' as const }))], { nights: highRhr }),
  shahar: read('Shahar Glazner', steady(50)),
  michal: read('Michal Raz', steady(45)),
};
const loadReadinessInputs = vi.fn(async (_db: unknown, ids: string[], _today: string, _o?: { write?: boolean }) =>
  Object.fromEntries(ids.filter(id => READS[id]).map(id => [id, READS[id]])));
vi.mock('@/lib/academy/readiness-server', () => ({
  loadReadinessInputs: (...a: Parameters<typeof loadReadinessInputs>) => loadReadinessInputs(...a),
  loadWeekCounts: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, { done: 3, planned: 5 }])),
}));
const plannedLoads = vi.fn();
vi.mock('@/lib/academy/load-server', () => ({
  loadTestsFor: async (_: unknown, ids: string[]) => Object.fromEntries(ids.map(id => [id, [{ date: '2026-01-01', thresholdSec: 252 }]])),
  plannedLoads: (...a: unknown[]) => plannedLoads(...a),
}));
const buildCoachTools = vi.fn();
vi.mock('@/lib/academy/coach-tools-build', () => ({ buildCoachTools: (...a: unknown[]) => buildCoachTools(...a) }));

const { GET } = await import('@/app/api/academy/readiness/route');
const get = (q = '') => GET(new Request(`http://x/api/academy/readiness${q}`));

const staff = (athleteId: string, extra: Record<string, unknown> = {}) => ({
  denied: null, caller: { athleteId, isStaff: true, isSuperUser: false, role: 'academy_coach', ...extra },
});

beforeEach(() => {
  loadReadinessInputs.mockClear();
  plannedLoads.mockReset();
  buildCoachTools.mockReset();
  plannedLoads.mockResolvedValue({ byWeek: {}, byDate: {} });
  buildCoachTools.mockResolvedValue({ pace: [], paused: [] });
});

describe('C1: the list', () => {
  it('is staff only', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'shahar', isStaff: false, isSuperUser: false, role: 'runner' } });
    expect((await get()).status).toBe(403);
    expect(loadReadinessInputs).not.toHaveBeenCalled();
  });

  it('passes the auth denial straight through', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await get()).status).toBe(401);
  });

  it('a coach sees only their own trainees', async () => {
    resolveVerifiedCaller.mockResolvedValue(staff('c2'));
    const body = await (await get()).json();
    expect(body.rows.map((r: { athleteId: string }) => r.athleteId)).toEqual(['michal']);
    expect(loadReadinessInputs.mock.calls[0][1]).toEqual(['michal']);
    expect(body.alert).toBeNull();
  });

  it('the manager sees everyone, most tired first, with the one alert', async () => {
    resolveVerifiedCaller.mockResolvedValue(staff('admin', { isManager: true }));
    const body = await (await get()).json();
    expect(body.rows.map((r: { athleteId: string }) => r.athleteId)[0]).toBe('yoav');
    expect(body.alert).toMatchObject({ athleteId: 'yoav', name: 'Yoav Cohen', reasons: ['veryTired', 'rhr'] });
    expect(body.rows[0]).toMatchObject({ initials: 'YC', bandKey: 'veryTired', weekDone: 3, weekPlanned: 5, paused: true });
    expect(body.rows[0].spark.length).toBeGreaterThan(1);
  });

  it('?scope=coach narrows a manager to their own', async () => {
    resolveVerifiedCaller.mockResolvedValue(staff('c1', { isManager: true }));
    const body = await (await get('?scope=coach')).json();
    expect(body.rows.map((r: { athleteId: string }) => r.athleteId).sort()).toEqual(['shahar', 'yoav']);
  });

  it('prices nothing it would store under view-as', async () => {
    resolveVerifiedCaller.mockResolvedValue(staff('c1', { viewingAsBy: 'admin@club' }));
    await get();
    expect(loadReadinessInputs.mock.calls[0][3]).toEqual({ write: false });
  });
});

describe('C2: one trainee', () => {
  it('is the trainee\'s coach\'s, not another coach\'s, and not the trainee\'s own', async () => {
    requireCallerForAthlete.mockResolvedValue(staff('c2'));
    expect((await get('?athleteId=shahar')).status).toBe(403);
    requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId: 'shahar', isStaff: false, isSuperUser: false, role: 'runner' } });
    expect((await get('?athleteId=shahar')).status).toBe(403);
    expect(loadReadinessInputs).not.toHaveBeenCalled();
  });

  it('projects this week\'s rest and next week from the plan, to next Saturday', async () => {
    requireCallerForAthlete.mockResolvedValue(staff('c1'));
    const thisWeek = weekStartOf(TODAY);
    const nextWeek = shiftDate(thisWeek, 7);
    const byDate: Record<string, number> = {};
    for (let i = 0; i < 7; i += 1) byDate[shiftDate(nextWeek, i)] = i % 2 ? 0 : 80; // 320 next week
    plannedLoads.mockResolvedValue({ byWeek: { [nextWeek]: 320 }, byDate });
    const res = await get('?athleteId=shahar');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(plannedLoads.mock.calls[0][1]).toBe('shahar');
    expect(plannedLoads.mock.calls[0][2]).toEqual([thisWeek, nextWeek]);
    expect(plannedLoads.mock.calls[0][3]).toBe(252);
    expect(body.projection).toMatchObject({ nextWeekLoad: 320, verdict: expect.any(String), projectedForm: expect.any(Number) });
    expect(body.projection.series[body.projection.series.length - 1].date).toBe(shiftDate(nextWeek, 6));
    expect(body.series).toHaveLength(9);
    expect(body.numbers).toMatchObject({ bandKey: expect.any(String) });
    expect(body.feel).toMatchObject({ weekDone: 3, weekPlanned: 5, pain: false });
  });

  it('the pace suggestion is the coach tools\', gated with the readiness the route read', async () => {
    requireCallerForAthlete.mockResolvedValue(staff('c1'));
    buildCoachTools.mockResolvedValue({ pace: [], paused: [{ athleteId: 'yoav', name: 'Yoav Cohen', reasons: ['veryTired', 'rhr'] }] });
    const body = await (await get('?athleteId=yoav')).json();
    expect(body.pace).toEqual({ suggestion: null, held: ['veryTired', 'rhr'], gate: { paused: true, reasons: ['veryTired', 'rhr'] } });
    const [, ids, opts] = buildCoachTools.mock.calls[0];
    expect(ids).toEqual(['yoav']);
    expect(opts.readiness.yoav).toBe(READS.yoav);
    expect(opts).toMatchObject({ withMissedKm: false, write: true });
  });
});
