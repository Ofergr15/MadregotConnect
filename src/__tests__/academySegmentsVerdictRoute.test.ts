import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * `GET /api/academy/segments?verdict=1` — "did this run match the plan", for one
 * run, on the activity detail every athlete already opens.
 *
 * The three things here that a refactor could break invisibly:
 *  - **Who may read the per-rep paces.** The verdict is member-visible on purpose
 *    (the planned band and the actual pace line already sit on the same chart for
 *    any member), but a rep-by-rep readout of someone else's intervals is not, so
 *    it is trimmed for anyone but the athlete and staff. A regression here leaks
 *    quietly and looks fine on screen.
 *  - **Which run gets graded.** The detail page asks about the run on screen;
 *    "closest to planned distance" would happily grade the other one that day.
 *  - **That a ride is never graded against a running plan.**
 */

const resolveVerifiedCaller = vi.fn();
const mayActFor = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
  mayActFor: (caller: unknown, id: string) => mayActFor(caller, id),
}));

vi.mock('@/lib/academy/settings-server', () => ({
  loadAcademySettings: () => Promise.resolve(DEFAULT_ACADEMY_SETTINGS),
}));

type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];
let respond: (op: Op) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

function chainFor(record: Op): unknown {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(respond(record)).then(resolve, reject);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => {
          const { data, error } = respond(record);
          return Promise.resolve({ data: (data || [])[0] ?? null, error });
        };
      }
      return (...args: unknown[]) => {
        record.calls.push([prop as string, args]);
        return chainFor(record);
      };
    },
  });
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, calls: [] };
      ops.push(record);
      return chainFor(record);
    },
  }),
}));

const { GET } = await import('@/app/api/academy/segments/route');

const ATHLETE = 'aaaaaaaa-0000-0000-0000-000000000001';
const DATE = '2026-09-09'; // Wednesday of the plan week starting 2026-09-06

/** 6×400 at 3:20–3:25 with 200 m jogs — a session with reps to look for. */
const intervals = {
  dayOfWeek: 3,
  name: '6x400',
  distanceMinKm: 3.6,
  distanceMaxKm: 3.6,
  steps: [{
    order: 1,
    type: 'interval',
    durationType: 'open',
    targetType: 'no_target',
    repeatCount: 6,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 205 },
      { order: 2, type: 'recovery', durationType: 'distance', durationValue: 200, targetType: 'no_target' },
    ],
  }],
};

/** All six reps run at 3:22, each followed by a jog — the watch's own laps. */
const laps = Array.from({ length: 6 }, () => [
  { distance: 400, duration: 81, averagePace: 202 },
  { distance: 200, duration: 84, averagePace: 420 },
]).flat();

const theRun = {
  id: 'act-session',
  garmin_activity_id: 1,
  start_time: `${DATE}T06:00:00Z`,
  distance: 6000,
  duration: 1800,
  moving_duration: 1800,
  average_pace: 300,
  activity_type: 'running',
  laps,
};

/** A second, longer run the same day — what "closest to planned" would pick. */
const theOtherRun = { ...theRun, id: 'act-easy', distance: 3600, laps: [] };

function stub(activities: unknown[] = [theRun, theOtherRun]) {
  respond = (op) => {
    if (op.table === 'weekly_plans') {
      const isShared = op.calls.some(([m, a]) => m === 'eq' && a[0] === 'coach_id');
      return {
        data: isShared
          ? [{ week_start_date: '2026-09-06', parsed_workouts: { workouts: [intervals] }, created_at: '2026-09-05T00:00:00Z' }]
          : [],
        error: null,
      };
    }
    if (op.table === 'athletes') return { data: [{ group_id: 'g1' }], error: null };
    if (op.table === 'groups') return { data: [{ name: 'Group A - SUB 2:30' }], error: null };
    if (op.table === 'athlete_activities') return { data: activities, error: null };
    return { data: [], error: null };
  };
}

const call = (query: string) =>
  GET(new Request(`https://x/api/academy/segments?${query}`));

beforeEach(() => {
  ops = [];
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ATHLETE, isStaff: false } });
  mayActFor.mockReturnValue(true);
  stub();
});

describe('GET /api/academy/segments?verdict=1', () => {
  it('grades the run the caller named, not the closest to planned distance', async () => {
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-session`)).json();
    expect(body.verdict).toMatchObject({ activityId: 'act-session', workoutName: '6x400' });
    expect(body.verdict.efforts).toMatchObject({ verdict: 'confirmed', neededTotal: 6, foundTotal: 6 });
  });

  it('gives the athlete their own rep paces', async () => {
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-session`)).json();
    expect(body.verdict.efforts.requirements[0].paces).toEqual([202, 202, 202, 202, 202, 202]);
  });

  // The counts answer "did they do the session"; the rep-by-rep readout is the
  // athlete's and staff's. This is the line the mode was allowed to cross on.
  it('trims the rep paces for a teammate, keeping the counts', async () => {
    mayActFor.mockReturnValue(false);
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-session`)).json();
    expect(body.verdict.efforts.requirements[0].paces).toEqual([]);
    expect(body.verdict.efforts).toMatchObject({ verdict: 'confirmed', neededTotal: 6, foundTotal: 6 });
    expect(body.verdict.efforts.requirements[0]).toMatchObject({ needed: 6, found: 6, attempted: 6 });
  });

  // The default mode returns the athlete's laps step by step and stays self-or-staff.
  it('still refuses the per-segment mode to a teammate', async () => {
    mayActFor.mockReturnValue(false);
    const res = await call(`athleteId=${ATHLETE}&date=${DATE}`);
    expect(res.status).toBe(403);
  });

  it('answers bands and verdict in one response when both are asked for', async () => {
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&bands=1&verdict=1&activityId=act-session`)).json();
    expect(Array.isArray(body.bands)).toBe(true);
    expect(body.verdict).toBeTruthy();
    // One plan lookup for both: the activity detail's whole reason for combining.
    expect(ops.filter(o => o.table === 'athlete_activities')).toHaveLength(1);
  });

  it('leaves bands alone when only they are asked for — no lap fetch', async () => {
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&bands=1`)).json();
    expect(Array.isArray(body.bands)).toBe(true);
    expect(body.verdict).toBeUndefined();
    expect(ops.some(o => o.table === 'athlete_activities')).toBe(false);
  });

  it('will not grade a ride against a running plan', async () => {
    stub([{ ...theRun, activity_type: 'cycling' }]);
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-session`)).json();
    expect(body.verdict).toBeNull();
    expect(body.reason).toBe('activity is not a run');
  });

  it('says there is no plan rather than inventing one', async () => {
    respond = (op) => op.table === 'weekly_plans'
      ? { data: [], error: null }
      : { data: [{ group_id: 'g1', name: 'Group A' }], error: null };
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&bands=1&verdict=1`)).json();
    expect(body).toEqual({ bands: null, verdict: null, reason: 'no planned workout for this day' });
  });

  it('says there is no run on the day when the athlete did not run', async () => {
    stub([]);
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1`)).json();
    expect(body.verdict).toBeNull();
    expect(body.reason).toBe('no completed activity on this day');
  });

  // Both the chart's target band and the verdict come from this one lookup, so a
  // `draft` week must reach neither: the coach is still moving days around.
  it('reads only a published plan, never a draft', async () => {
    await call(`athleteId=${ATHLETE}&date=${DATE}&bands=1&verdict=1`);
    const plans = ops.filter(o => o.table === 'weekly_plans');
    expect(plans.length).toBeGreaterThan(0);
    for (const op of plans) {
      const statuses = op.calls.find(([m, a]) => m === 'in' && a[0] === 'status')?.[1][1];
      expect(statuses).toEqual(['pushed', 'partial']);
    }
  });

  it('requires a verified caller', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('nope', { status: 401 }) });
    expect((await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1`)).status).toBe(401);
  });
});
