import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { buildWeekBreakdown, getDisplayWeekStart } from '@/lib/plans/workout-parsing';

/**
 * GET /api/dashboard/weekly: the previous week's total is computed exactly like this week's range (same function, same
 * inputs incl. that week's published one-day sessions), so the week-over-week % compares like with like. Synthetic rows.
 */
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const who = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<object>()), resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: who.id } }) }));
const h = vi.hoisted(() => ({ byWeek: {} as Record<string, unknown[]>, spanFails: false }));
vi.mock('@/lib/day-session/week-merge', async (orig) => ({ ...(await orig<object>()),
  daySessionWorkouts: async (w: string) => h.byWeek[w] ?? [],
  daySessionWorkoutsByWeek: async () => (h.spanFails ? { ok: false } : { ok: true, byWeek: new Map(Object.entries(h.byWeek)) }),
}));
const weekly = await import('@/app/api/dashboard/weekly/route');

const step = (m: number) => ({ order: 1, type: 'active', durationType: 'distance', durationValue: m, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 320 });
const timed = (s: number) => ({ order: 1, type: 'active', durationType: 'time', durationValue: s, targetType: 'no_target' });
const planOf = (km: number[]) => ({ workouts: km.map((k, i) => ({ dayOfWeek: i, name: `Run ${i}`, steps: [k > 0 ? step(k * 1000) : timed(3600)] })) });
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const ME = uid(); const GROUP = uid();
const cur = getDisplayWeekStart(new Date());
const prevStart = addDays(cur, -7);
const prevPlan = planOf([10, 0, 12, 0, 8]); // two TIMED (estimated) sessions: where estimators differ
const curPlan = planOf([12, 14, 10, 0, 16]);
const prevDay = [{ dayOfWeek: 6, name: 'Saturday session', workoutKey: `day:${addDays(prevStart, 6)}`, steps: [step(9000)] }];

beforeEach(() => {
  who.id = ME;
  h.byWeek = { [prevStart]: prevDay };
  h.spanFails = false;
  db = createMemoryDb({ schema: {
    athletes: ['id', 'name', 'garmin_auth', 'is_academy', 'group_id', 'groups'],
    weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
    groups: ['id', 'pace_profile', 'coach_id'],
  } });
  db.tables.athletes.push({ id: ME, name: 'Me', garmin_auth: null, is_academy: false, group_id: GROUP, groups: null });
  db.tables.weekly_plans.push(
    { id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: prevStart, parsed_workouts: prevPlan, status: 'pushed', created_at: '2026-11-01T00:00:00Z' },
    { id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: cur, parsed_workouts: curPlan, status: 'pushed', created_at: '2026-11-08T00:00:00Z' },
  );
});

describe('weekly: previous week on the same basis as this week', () => {
  it('prevWeekTotal = midpoint of buildWeekBreakdown(prev plan + prev one-day sessions)', async () => {
    const body = await (await weekly.GET(new Request('http://x/api/dashboard/weekly'))).json();
    const { mergeDaySessions } = await import('@/lib/day-session/week-merge');
    const expected = buildWeekBreakdown(mergeDaySessions(prevPlan as never, prevDay as never));
    expect(body.prevWeekTotal).toBe(Math.round(((expected.weekTotalMin + expected.weekTotalMax) / 2) * 10) / 10);
    expect(body.prevWeekTotal).toBeGreaterThan(30 + 9 - 0.01); // includes the 9 km one-day session
  });
  it('the 20-week history is on the same basis: last week\'s volume == prevWeekTotal, this week\'s == the range midpoint', async () => {
    const body = await (await weekly.GET(new Request('http://x/api/dashboard/weekly'))).json();
    const vol = new Map(body.weeklyVolumes.map((v: { week: string; volume: number }) => [v.week, v.volume]));
    expect(vol.get(prevStart)).toBe(body.prevWeekTotal);
    expect(vol.get(cur)).toBe(Math.round(((body.weekTotalMin + body.weekTotalMax) / 2) * 10) / 10);
    const long = new Map(body.longRunProgression.map((v: { week: string; distance: number }) => [v.week, v.distance]));
    expect(long.get(prevStart)).toBeGreaterThanOrEqual(12); // the longest planned session that week
    expect(body.weeklyVolumes.map((v: { weekNum: number }) => v.weekNum)).toEqual(body.weeklyVolumes.map((_: unknown, i: number) => i + 1));
  });
  it('the span read failing is SAID: historyCoverage.daySessions = unavailable, history plan-only (not silently the same)', async () => {
    h.spanFails = true;
    const body = await (await weekly.GET(new Request('http://x/api/dashboard/weekly'))).json();
    expect(body.historyCoverage).toMatchObject({ daySessions: 'unavailable', span: { from: prevStart, to: cur } });
    const vol = new Map(body.weeklyVolumes.map((v: { week: string; volume: number }) => [v.week, v.volume]));
    const planOnly = buildWeekBreakdown(prevPlan as never);
    expect(vol.get(prevStart)).toBe(Math.round(((planOnly.weekTotalMin + planOnly.weekTotalMax) / 2) * 10) / 10);
  });
  it('a week with published one-day sessions but NO weekly plan appears in the history', async () => {
    const midWeek = addDays(prevStart, -7);
    db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: addDays(prevStart, -14), parsed_workouts: planOf([10]), status: 'pushed', created_at: '2026-10-25T00:00:00Z' });
    h.byWeek[midWeek] = [{ dayOfWeek: 3, name: 'Standalone', workoutKey: `day:${addDays(midWeek, 3)}`, steps: [step(11000)] }];
    const body = await (await weekly.GET(new Request('http://x/api/dashboard/weekly'))).json();
    const weeks = body.weeklyVolumes.map((v: { week: string }) => v.week);
    expect(weeks).toContain(midWeek);
    expect(body.weeklyVolumes.find((v: { week: string }) => v.week === midWeek).volume).toBeGreaterThan(10.9);
    expect(weeks).toEqual([...weeks].sort());
    expect(body.historyCoverage.daySessions).toBe('included');
  });
});
