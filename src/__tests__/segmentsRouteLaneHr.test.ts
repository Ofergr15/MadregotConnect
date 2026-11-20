import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * HTTP-level: GET /api/academy/segments for a LANE-2 athlete on a plan whose pace step carries a stray
 * lane HR. Through the real route + laneWorkouts + splitIntoGroups + grading, with a mock DB. Synthetic.
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

const ATHLETE = 'aaaaaaaa-0000-0000-0000-000000000002';
const DATE = '2026-09-09'; // Wednesday of the plan week starting 2026-09-06

/** 3×1 km written in pace: lane 1 3:45, lane 2 3:55 — and a stray lane-2 HR from the parse. */
const reps = {
  dayOfWeek: 3, name: '3x1km', distanceMinKm: 3, distanceMaxKm: 3,
  steps: [{
    order: 1, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 3,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace',
        targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225, targetHrMinPct: 170, targetHrMaxPct: 180,
        group2Pace: { min: 235, max: 235 }, group2HeartRate: { min: 150, max: 160 }, notes: '3:45 (3:55) ((4:05))' },
      { order: 2, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' },
    ],
  }],
};
const laps = Array.from({ length: 3 }, () => [
  { distance: 1000, duration: 235, averagePace: 235, averageHR: 172 },
  { distance: 250, duration: 90, averagePace: 360, averageHR: 140 },
]).flat();
const theRun = { id: 'act-1', garmin_activity_id: 1, start_time: `${DATE}T06:00:00Z`, distance: 3750, duration: 975,
  moving_duration: 975, average_pace: 260, activity_type: 'running', laps };

function stub(groupName = 'Group B - SUB 2:35', dbError: unknown = null) {
  respond = (op) => {
    if (dbError && op.table === 'weekly_plans') return { data: null, error: dbError };
    if (op.table === 'weekly_plans') {
      const isShared = op.calls.some(([m, a]) => m === 'eq' && a[0] === 'coach_id');
      return { data: isShared ? [{ week_start_date: '2026-09-06', parsed_workouts: { workouts: [reps] }, created_at: '2026-09-05T00:00:00Z' }] : [], error: null };
    }
    if (op.table === 'athletes') return { data: [{ id: ATHLETE, group_id: 'g-x' }], error: null };
    if (op.table === 'groups') return { data: [{ id: 'g-x', name: groupName }], error: null };
    if (op.table === 'athlete_activities') return { data: [theRun], error: null };
    return { data: [], error: null };
  };
}
const call = (q: string) => GET(new Request(`https://x/api/academy/segments?${q}`));
const writes = () => ops.flatMap(o => o.calls.filter(([m]) => ['insert', 'update', 'upsert', 'delete'].includes(m)).map(([m]) => `${o.table}.${m}`));

beforeEach(() => {
  ops = [];
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ATHLETE, isStaff: false } });
  mayActFor.mockReturnValue(true);
  stub();
});

describe('segments route, lane 2, pace step with a stray lane HR', () => {
  it('grades the reps on pace at the lane-2 band; no segment is graded on HR (the athlete ran 172 bpm)', async () => {
    const res = await call(`athleteId=${ATHLETE}&date=${DATE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const work = body.segments.filter((s: { type: string }) => s.type === 'interval');
    expect(work.length).toBeGreaterThan(0);
    for (const s of work) {
      expect(s.metric).toBe('pace');
      expect(s.plannedPaceMin).toBe(235);
    }
    expect(body.segments.some((s: { metric: string }) => s.metric === 'hr')).toBe(false);
    expect(writes()).toEqual([]);
  });
  it('the verdict path says the same: reps graded on the lane-2 pace band, 3/3 found', async () => {
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-1`)).json();
    expect(body.efforts).toMatchObject({ verdict: 'confirmed', neededTotal: 3, foundTotal: 3 });
    expect(body.efforts.requirements[0]).toMatchObject({ paceMin: 235, paceMax: 235, found: 3 });
    expect(writes()).toEqual([]);
  });
  it('a lane-1 athlete on the same plan: pace at 3:45', async () => {
    stub('Group A - SUB 2:30');
    const body = await (await call(`athleteId=${ATHLETE}&date=${DATE}`)).json();
    for (const s of body.segments.filter((x: { type: string }) => x.type === 'interval')) expect(s.plannedPaceMin).toBe(225);
  });
  it('error path: a failed plan read does not 500 into a fabricated verdict, and writes nothing', async () => {
    stub('Group B - SUB 2:35', { code: 'XX000', message: 'boom' });
    const res = await call(`athleteId=${ATHLETE}&date=${DATE}&verdict=1&activityId=act-1`);
    const body = await res.json().catch(() => ({}));
    expect(body.verdict ?? null).toBeNull();
    expect(writes()).toEqual([]);
  });
  it('unauthenticated → the gate\'s denial, no DB read', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: null });
    expect((await call(`athleteId=${ATHLETE}&date=${DATE}`)).status).toBe(401);
    expect(ops).toHaveLength(0);
  });
});
