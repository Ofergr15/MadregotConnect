import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * CHARACTERIZATION of production behaviour (no change): which GET /api/academy/segments requests reach Garmin
 * and write to athlete_activities (route.ts "3) Ensure laps", ~278-306). Real handler, mocked DB and a mocked
 * GarminClient; synthetic rows only, no real account. Every case records the Garmin calls and the DB writes.
 */
const h = vi.hoisted(() => ({
  ctor: vi.fn(),
  splits: vi.fn(),
  workout: vi.fn(),
}));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class { constructor(auth: unknown) { h.ctor(auth); }
    getActivitySplits(id: number) { return h.splits(id); }
    getActivityWorkout(id: number) { return h.workout(id); } },
}));
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r),
  mayActFor: () => true,
}));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: async () => false, seesPending: () => true }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: () => Promise.resolve(DEFAULT_ACADEMY_SETTINGS) }));
vi.mock('@/lib/garmin/stream-store', () => ({ loadActivityStream: async () => null }));

type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];
let activity: Record<string, unknown>;
let garminAuth: unknown = 'synthetic-sealed-token';
function chain(op: Op): unknown {
  return new Proxy({}, { get(_t, prop) {
    if (typeof prop === 'symbol') return undefined;
    const res = () => {
      if (op.table === 'weekly_plans') {
        const shared = op.calls.some(([m, a]) => m === 'eq' && a[0] === 'coach_id');
        return { data: shared ? [{ week_start_date: '2026-09-06', parsed_workouts: { workouts: [PLAN] }, created_at: 'x' }] : [], error: null };
      }
      if (op.table === 'athletes') {
        const wantsAuth = op.calls.some(([m, a]) => m === 'select' && String(a[0]).includes('garmin_auth'));
        return { data: [wantsAuth ? { garmin_auth: garminAuth } : { id: ATH, group_id: 'g1' }], error: null };
      }
      if (op.table === 'groups') return { data: [{ id: 'g1', name: 'Group A - SUB 2:30' }], error: null };
      if (op.table === 'athlete_activities') return { data: [activity], error: null };
      return { data: [], error: null };
    };
    if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko);
    if (prop === 'maybeSingle' || prop === 'single') return () => { const r = res(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: r.error }); };
    return (...args: unknown[]) => { op.calls.push([prop as string, args]); return chain(op); };
  } });
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from(t: string) { const op = { table: t, calls: [] }; ops.push(op); return chain(op); } }) }));

const { GET } = await import('@/app/api/academy/segments/route');
const ATH = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const DATE = '2026-09-09';
const PLAN = { dayOfWeek: 3, name: '3x1km', distanceMinKm: 3, distanceMaxKm: 3, steps: [{ order: 1, type: 'interval', durationType: 'open',
  targetType: 'no_target', repeatCount: 3, repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225 },
    { order: 2, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' }] }] };
const stampedLaps = Array.from({ length: 3 }, () => [
  { distance: 1000, duration: 225, averagePace: 225, wktStepIndex: 1 }, { distance: 250, duration: 90, averagePace: 360, wktStepIndex: 2 }]).flat();
const garminSplits = (stamped: boolean) => Array.from({ length: 3 }, () => [
  { distance: 1000, duration: 225, ...(stamped ? { wktStepIndex: 1 } : {}) }, { distance: 250, duration: 90, ...(stamped ? { wktStepIndex: 2 } : {}) }]).flat();
const garminWorkout = [{ workoutName: '3x1km', steps: [
  { stepIndex: 0, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:45' },
  { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:45' },
  { stepIndex: 2, intensity: 'REST', durationType: 'TIME', durationValue: 90 },
  { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 3 }] }];
const run = (o: Record<string, unknown>) => ({ id: 'act-1', garmin_activity_id: 99, garmin_workout_id: null, start_time: `${DATE}T06:00:00Z`,
  distance: 3750, duration: 945, moving_duration: 945, average_pace: 252, activity_type: 'running', laps: [], executed_workout: null, ...o });

const get = (q = 'verdict=1&activityId=act-1') => GET(new Request(`https://x/api/academy/segments?athleteId=${ATH}&date=${DATE}&${q}`));
const writes = () => ops.flatMap((o) => o.calls.filter(([m]) => ['insert', 'update', 'upsert', 'delete'].includes(m))
  .map(([m, a]) => `${o.table}.${m}(${Object.keys(a[0] as object).join(',')})`));
const garminCalls = () => ({ client: h.ctor.mock.calls.length, splits: h.splits.mock.calls.length, workout: h.workout.mock.calls.length });

beforeEach(() => {
  ops = []; garminAuth = 'synthetic-sealed-token';
  h.ctor.mockReset(); h.splits.mockReset().mockResolvedValue(garminSplits(true)); h.workout.mockReset().mockResolvedValue(garminWorkout);
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ATH, isStaff: false } });
});

describe('GET /api/academy/segments — Garmin calls and DB writes, by stored state (characterization)', () => {
  it('A. cached complete (stamped laps + step list): no Garmin, no writes', async () => {
    activity = run({ garmin_workout_id: 7, laps: stampedLaps, executed_workout: { workoutName: 'x', steps: [{ stepIndex: 1 }] } });
    expect((await get()).status).toBe(200);
    expect(garminCalls()).toEqual({ client: 0, splits: 0, workout: 0 });
    expect(writes()).toEqual([]);
  });
  it('B. no laps, plain run (no workout id): Garmin splits fetched, laps written; no step-list call (laps unstamped)', async () => {
    activity = run({});
    h.splits.mockResolvedValue(garminSplits(false));
    await get();
    expect(garminCalls()).toEqual({ client: 1, splits: 1, workout: 0 });
    expect(writes()).toEqual(['athlete_activities.update(laps)']);
  });
  it('C. no laps, workout run: splits fetched and written, then the step list fetched and written (two writes)', async () => {
    activity = run({ garmin_workout_id: 7 });
    await get();
    expect(garminCalls()).toEqual({ client: 1, splits: 1, workout: 1 });
    expect(writes()).toEqual(['athlete_activities.update(laps)', 'athlete_activities.update(executed_workout)']);
  });
  it('D. stamped laps cached but the step list missing: only the step list is fetched and written', async () => {
    activity = run({ garmin_workout_id: 7, laps: stampedLaps });
    await get();
    expect(garminCalls()).toEqual({ client: 1, splits: 0, workout: 1 });
    expect(writes()).toEqual(['athlete_activities.update(executed_workout)']);
  });
  it('E. the same as C in the default (per-segment) mode: same calls, same writes', async () => {
    activity = run({ garmin_workout_id: 7 });
    await get('activityId=act-1');
    expect(garminCalls()).toEqual({ client: 1, splits: 1, workout: 1 });
    expect(writes()).toHaveLength(2);
  });
  it('F. view-as: Garmin is still called, nothing is written', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ATH, isStaff: true, viewingAsBy: 'admin@example.test' } });
    activity = run({ garmin_workout_id: 7 });
    await get();
    expect(garminCalls()).toEqual({ client: 1, splits: 1, workout: 1 });
    expect(writes()).toEqual([]);
  });
  it('G. ?bands=1 alone: no activity read, no Garmin, no writes', async () => {
    activity = run({ garmin_workout_id: 7 });
    await get('bands=1');
    expect(ops.some((o) => o.table === 'athlete_activities')).toBe(false);
    expect(garminCalls()).toEqual({ client: 0, splits: 0, workout: 0 });
  });
  it('H. athlete has no Garmin credential: no Garmin, no writes', async () => {
    garminAuth = null;
    activity = run({ garmin_workout_id: 7 });
    await get();
    expect(garminCalls()).toEqual({ client: 0, splits: 0, workout: 0 });
    expect(writes()).toEqual([]);
  });
  it('I. Garmin throws: 200, no writes (errors swallowed)', async () => {
    activity = run({ garmin_workout_id: 7 });
    h.splits.mockRejectedValue(new Error('garmin down'));
    expect((await get()).status).toBe(200);
    expect(writes()).toEqual([]);
  });
  it('J. there is NO dry-read switch today: ?readOnly=1 / ?dryRun=1 still call Garmin and write', async () => {
    for (const q of ['readOnly=1', 'dryRun=1', 'readonly=true']) {
      ops = []; h.ctor.mockClear(); h.splits.mockClear(); h.workout.mockClear();
      activity = run({ garmin_workout_id: 7 });
      await get(`verdict=1&activityId=act-1&${q}`);
      expect(garminCalls().splits).toBe(1);
      expect(writes()).toHaveLength(2);
    }
  });
});
