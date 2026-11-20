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
const h = vi.hoisted(() => ({ fail: false, days: [] as unknown[] }));
vi.mock('@/lib/day-session/week-merge', async (orig) => ({ ...(await orig<object>()),
  daySessionWorkoutsChecked: async () => (h.fail ? { ok: false } : { ok: true, workouts: h.days }) }));
const weekRoute = await import('@/app/api/plans/week/route');
const { planBreakdownFor } = await import('@/lib/week-story/server');

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
beforeEach(() => { who.id = ME; h.fail = false; h.days = day; seed(true); });

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
