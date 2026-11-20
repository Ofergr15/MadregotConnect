import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { NextRequest } from 'next/server';

/**
 * GET /api/plans/week and the week story's planBreakdownFor: a failed one-day-session read is SAID (coverage
 * 'unavailable', plan-only numbers), never folded in as "no one-day sessions". Synthetic rows; reads only.
 */
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const who = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: who.id, isStaff: false, isSuperUser: false } }) }));
const h = vi.hoisted(() => ({ fail: false, days: [] as unknown[], calls: 0 }));
vi.mock('@/lib/day-session/week-merge', async (orig) => ({ ...(await orig<object>()),
  daySessionWorkoutsChecked: async () => { h.calls++; return h.fail ? { ok: false } : { ok: true, workouts: h.days }; } }));
const weekRoute = await import('@/app/api/plans/week/route');
const { planBreakdownFor, planWeekFor, safePlanWeek, planCoverageOf } = await import('@/lib/week-story/server');

const WEEK = '2026-11-15';
const step = (m: number) => ({ order: 1, type: 'active', durationType: 'distance', durationValue: m, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 320 });
const plan = { workouts: [{ dayOfWeek: 0, name: 'Sun', steps: [step(10000)] }, { dayOfWeek: 2, name: 'Tue', steps: [step(12000)] }] };
const day = [{ dayOfWeek: 6, name: 'Saturday session', workoutKey: `day:2026-11-21`, steps: [step(9000)] }];
const ME = uid();
const get = async () => (await weekRoute.GET(new NextRequest(`http://x/api/plans/week?weekStart=${WEEK}`))).json();

function seed(withPlan: boolean) {
  db = createMemoryDb({ schema: {
    athletes: ['id', 'name', 'is_academy', 'group_id', 'groups', 'garmin_auth'],
    weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
    groups: ['id', 'name', 'pace_profile', 'coach_id'],
    athlete_group_history: ['athlete_id', 'group_id', 'from_date', 'to_date'],
  } });
  db.tables.athletes.push({ id: ME, name: 'Me', is_academy: false, group_id: null, groups: null, garmin_auth: null });
  if (withPlan) db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: WEEK, parsed_workouts: plan, status: 'pushed', created_at: '2026-11-14T00:00:00Z' });
}
beforeEach(() => { who.id = ME; h.fail = false; h.days = day; h.calls = 0; seed(true); });

describe('GET /api/plans/week: coverage', () => {
  it('included: plan + one-day session merged, coverage included', async () => {
    const b = await get();
    expect(b).toMatchObject({ hasPlan: true, coverage: { daySessions: 'included' } });
    expect(b.weekTotalMax).toBeGreaterThan(31 - 0.01);
  });
  it('read fails: plan-only numbers, coverage unavailable (not silently the same)', async () => {
    h.fail = true;
    const b = await get();
    expect(b).toMatchObject({ hasPlan: true, coverage: { daySessions: 'unavailable' } });
    expect(b.weekTotalMax).toBeLessThan(23);
  });
  it('no plan row and the read fails: hasPlan false AND coverage unavailable, so it is not "nothing this week"', async () => {
    seed(false); h.fail = true;
    expect(await get()).toMatchObject({ hasPlan: false, coverage: { daySessions: 'unavailable' } });
  });
  it('no plan row, one-day session only: hasPlan true from the session, coverage included', async () => {
    seed(false);
    expect(await get()).toMatchObject({ hasPlan: true, hasClubPlan: false, coverage: { daySessions: 'included' } });
  });
});

describe('week story planBreakdownFor: coverage', () => {
  it('included / unavailable carried on the breakdown; ownOnly never reads one-day sessions (not_applicable)', async () => {
    expect((await planBreakdownFor(db.client as never, ME, WEEK))?.daySessionCoverage).toBe('included');
    h.fail = true;
    const r = await planBreakdownFor(db.client as never, ME, WEEK);
    expect(r?.daySessionCoverage).toBe('unavailable');
    expect(r?.weekTotalMax).toBeLessThan(23);
    expect(await planBreakdownFor(db.client as never, ME, WEEK, { ownOnly: true })).toBeNull(); // club row, ownOnly → null
  });
});

describe('week story planWeekFor: coverage survives when there are no numbers', () => {
  it('NO plan row + the one-day read FAILS → { breakdown: null, unavailable }, not "no plan"', async () => {
    seed(false); h.fail = true;
    expect(await planWeekFor(db.client as never, ME, WEEK)).toEqual({ breakdown: null, daySessionCoverage: 'unavailable' });
  });
  it('NO plan row + the read SUCCEEDS with no sessions → { breakdown: null, included }: truly nothing that week', async () => {
    seed(false); h.days = [];
    expect(await planWeekFor(db.client as never, ME, WEEK)).toEqual({ breakdown: null, daySessionCoverage: 'included' });
  });
  it('NO plan row + sessions read → numbers from the sessions, included', async () => {
    seed(false);
    const r = await planWeekFor(db.client as never, ME, WEEK);
    expect(r.daySessionCoverage).toBe('included');
    expect(r.breakdown?.weekTotalMax).toBeGreaterThan(8.9);
  });
  it('ownOnly with the athlete\'s OWN plan row: numbers, not_applicable, and the one-day read is never made', async () => {
    seed(false);
    // Own rows count only for an academy athlete (scope-server ownPlanRowsCount); a club runner's own rows are dropped.
    db.tables.athletes[0].is_academy = true;
    db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: ME, week_start_date: WEEK, parsed_workouts: plan, status: 'pushed', created_at: '2026-11-14T00:00:00Z' });
    const r = await planWeekFor(db.client as never, ME, WEEK, { ownOnly: true });
    expect(r.daySessionCoverage).toBe('not_applicable');
    expect(r.breakdown?.weekTotalMax).toBeGreaterThan(21.9);
    expect(h.calls).toBe(0);
  });
  it('ownOnly with only a club row: no numbers, not_applicable, no read', async () => {
    expect(await planWeekFor(db.client as never, ME, WEEK, { ownOnly: true })).toEqual({ breakdown: null, daySessionCoverage: 'not_applicable' });
    expect(h.calls).toBe(0);
  });
  it('planBreakdownFor (numbers only) is planWeekFor().breakdown', async () => {
    seed(false); h.fail = true;
    expect(await planBreakdownFor(db.client as never, ME, WEEK)).toBeNull();
  });
});

describe('week story planCoverage mapping, including a read that THROWS', () => {
  it('a plan-week read that throws is unavailable, never null ("no plan")', async () => {
    const r = await safePlanWeek(Promise.reject(new Error('plan query failed')));
    expect(r).toEqual({ breakdown: null, daySessionCoverage: 'unavailable' });
    expect(planCoverageOf(r)).toBe('unavailable');
  });
  it('maps every outcome: numbers carry their own coverage; no numbers → unavailable or null', async () => {
    expect(planCoverageOf({ breakdown: null, daySessionCoverage: 'unavailable' })).toBe('unavailable');
    expect(planCoverageOf({ breakdown: null, daySessionCoverage: 'included' })).toBeNull();
    expect(planCoverageOf({ breakdown: null, daySessionCoverage: 'not_applicable' })).toBeNull();
    const withNumbers = await planWeekFor(db.client as never, ME, WEEK);
    expect(planCoverageOf(withNumbers)).toBe('included');
    h.fail = true;
    expect(planCoverageOf(await planWeekFor(db.client as never, ME, WEEK))).toBe('unavailable');
  });
  it('a successful read passes through safePlanWeek unchanged', async () => {
    const r = await safePlanWeek(planWeekFor(db.client as never, ME, WEEK));
    expect(r.daySessionCoverage).toBe('included');
    expect(r.breakdown).not.toBeNull();
  });
});
