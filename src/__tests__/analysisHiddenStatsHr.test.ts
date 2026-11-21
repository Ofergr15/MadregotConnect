import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/activities/analysis on a run started as a structured workout (laps stamped with
 * `wktStepIndex`), through the REAL handler and the REAL run-analysis/workout module — only
 * I/O is mocked. The hole this pins shut (owner-approved scope: hidden pace / heart rate are
 * withheld from members who are not the runner and not staff):
 *  - hidden heart rate: `workout` still carried every lap's hr / maxHr and avgHr.
 * And what must NOT change: the runner and staff see everything; a runner who only switched
 * the HR line off (nothing hidden) still shows lap averages, as before. Synthetic data only.
 */
const ACT = '00000000-0000-4000-8000-000000000c01';
const OWNER = 'owner-athlete';
const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown },
  runnerAllowsHr: true,
}));

vi.mock('@/lib/auth/self-or-staff', async (o) => ({
  ...(await o<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: vi.fn(async () => ({ denied: null, caller: h.caller })),
}));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: vi.fn(async () => false), seesPending: () => false }));
vi.mock('@/lib/athletes/hr-trace-privacy', async (o) => ({
  ...(await o<typeof import('@/lib/athletes/hr-trace-privacy')>()),
  readHrTracePublic: vi.fn(async () => h.runnerAllowsHr),
}));

// 2 km warm-up, 5 × (1000 m in 210 s = 3:30/km, 400 m jog), 1 km cool-down — as Garmin stamps
// a structured workout's laps.
type Lap = { distance: number; duration: number; averageHR: number; maxHR: number; intensityType: string; wktStepIndex: number };
const LAPS: Lap[] = [{ distance: 2000, duration: 600, averageHR: 135, maxHR: 142, intensityType: 'WARMUP', wktStepIndex: 0 }];
for (let i = 0; i < 5; i++) {
  LAPS.push({ distance: 1000, duration: 210, averageHR: 171 + i, maxHR: 178 + i, intensityType: 'ACTIVE', wktStepIndex: 2 });
  LAPS.push({ distance: 400, duration: 150, averageHR: 140, maxHR: 150, intensityType: 'RECOVERY', wktStepIndex: 3 });
}
LAPS.push({ distance: 1000, duration: 330, averageHR: 138, maxHR: 145, intensityType: 'COOLDOWN', wktStepIndex: 4 });
const STEPS = [
  { stepIndex: 0, intensity: 'WARMUP', distanceM: 2000 },
  { stepIndex: 1, iterations: 5 },
  { stepIndex: 2, intensity: 'INTERVAL', distanceM: 1000, repeatFrom: 1 },
  { stepIndex: 3, intensity: 'RECOVERY', distanceM: 400, repeatFrom: 1 },
  { stepIndex: 4, intensity: 'COOLDOWN', distanceM: 1000 },
];
const T: number[] = []; const D: number[] = []; const CAD: number[] = []; const HR: number[] = [];
{
  let t = 0; let d = 0;
  for (const l of LAPS) for (let s = 0; s < l.duration; s++) {
    t++; d += l.distance / l.duration;
    T.push(t); D.push(d); CAD.push(l.intensityType === 'ACTIVE' ? 190 : 170); HR.push(l.averageHR);
  }
}
vi.mock('@/lib/garmin/stream-store', () => ({ loadActivityStream: vi.fn(async () => ({ series: { t: T, d: D, cad: CAD, hr: HR }, laps: LAPS })) }));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: vi.fn(async () => []) }));
vi.mock('@/lib/prs/attach-laps', () => ({ attachLapsForPrs: vi.fn(async (_a: unknown, _b: unknown, r: unknown) => r) }));
vi.mock('@/lib/prs/overrides-store', () => ({ readPrOverrides: vi.fn(async () => []) }));
vi.mock('@/lib/prs/exclusions-store', () => ({ readPrExclusions: vi.fn(async () => []) }));

const ROW = { id: ACT, athlete_id: OWNER, start_time: '2026-11-19T06:00:00+00:00', distance: 10000, duration: 2730, average_pace: 273,
  start_lat: null, start_lng: null, laps: LAPS, executed_workout: { steps: STEPS } };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b, eq: () => b, neq: () => b, not: () => b, gte: () => b, lte: () => b, lt: () => b, in: () => b,
        limit: () => b, order: () => b, range: () => b,
        maybeSingle: async () => ({ data: table === 'athlete_activities' ? ROW : null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve(table === 'feed_items' ? h.feed : { data: [], error: null }).then(ok, bad),
      };
      return b;
    },
  }),
}));

const asOwner = () => { h.caller = { athleteId: OWNER, isStaff: false, isSuperUser: false }; };
const asStaff = () => { h.caller = { athleteId: 'coach', isStaff: true, isSuperUser: false }; };
const asTeammate = () => { h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; };
const hide = (...f: string[]) => { h.feed = { data: [{ payload: { hiddenFields: f } }], error: null }; };

async function analysis(query = '') {
  const { GET } = await import('@/app/api/activities/analysis/route');
  const res = await GET(new Request(`http://x/api/activities/analysis?activityId=${ACT}${query}`));
  expect(res.status).toBe(200);
  return res.json();
}
type SegOut = { hr: number | null; maxHr: number | null; pace: number | null; kind: string };
const allSegs = (w: { segments: SegOut[]; reps: SegOut[]; strides: SegOut[] }) => [...w.segments, ...w.reps, ...w.strides];

beforeEach(() => { h.feed = { data: [], error: null }; h.runnerAllowsHr = true; });

describe('analysis on a structured workout — hidden heart rate', () => {
  it('teammate: every segment / rep / stride hr and maxHr, and avgHr, are null; paces and technique stay', async () => {
    asTeammate(); hide('heart_rate');
    const b = await analysis();
    expect(b.hrVisible).toBe(false);
    expect(b.recovery).toEqual([]);
    expect(b.workout.avgHr).toBeNull();
    const segs = allSegs(b.workout);
    expect(b.workout.reps.length).toBe(5);
    for (const s of segs) { expect(s.hr).toBeNull(); expect(s.maxHr).toBeNull(); }
    expect(b.workout.reps.every((r: SegOut) => r.pace === 210)).toBe(true);
    expect(b.technique.length).toBe(5);
  });
  it('teammate, pace and heart rate hidden: no workout, no HR anywhere', async () => {
    asTeammate(); hide('pace', 'heart_rate');
    const b = await analysis();
    expect(b.workout).toBeNull();
    expect(b.recovery).toEqual([]);
    expect(b.hrVisible).toBe(false);
  });
  it('teammate, hidden-fields read fails: fails closed — no workout, HR closed', async () => {
    asTeammate(); h.feed = { data: null as never, error: { message: 'boom' } };
    const b = await analysis();
    expect(b.workout).toBeNull();
    expect(b.hrVisible).toBe(false);
  });
});

describe('analysis on a structured workout — unchanged', () => {
  it('HR line switched OFF by the runner, nothing hidden: lap HR averages stay (existing rule), trace-based recovery off', async () => {
    asTeammate(); h.runnerAllowsHr = false;
    const b = await analysis();
    expect(b.hrVisible).toBe(false);
    expect(b.recovery).toEqual([]);
    expect(b.workout.avgHr).not.toBeNull();
    expect(b.workout.reps.map((r: SegOut) => r.hr)).toEqual([171, 172, 173, 174, 175]);
    expect(b.technique.length).toBe(5);
  });
  it.each([['owner', asOwner], ['staff', asStaff]])('%s sees workout HR, technique and recovery despite hidden pace and HR', async (_n, as) => {
    as(); hide('pace', 'heart_rate'); h.runnerAllowsHr = false;
    const b = await analysis();
    expect(b.hrVisible).toBe(true);
    expect(b.workout.reps.map((r: SegOut) => r.hr)).toEqual([171, 172, 173, 174, 175]);
    expect(b.workout.avgHr).not.toBeNull();
    expect(b.technique.length).toBe(5);
    expect(b.recovery.length).toBeGreaterThan(0);
  });
});
