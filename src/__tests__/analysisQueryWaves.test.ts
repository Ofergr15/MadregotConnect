import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PERF: how many sequential database waves /api/activities/analysis costs a teammate.
 * Was ~9 in a row; the independent reads now go out together.
 *
 * (Fixture borrowed from analysisHiddenStatsHr.test.ts.) /api/activities/analysis on a run started as a structured workout (laps stamped with
 * `wktStepIndex`), through the REAL handler and the REAL run-analysis/workout module — only
 * I/O is mocked. The hole this pins shut (owner-approved scope: hidden pace / heart rate are
 * withheld from members who are not the runner and not staff):
 *  - hidden heart rate: `workout` still carried every lap's hr / maxHr and avgHr.
 * And what must NOT change: the runner and staff see everything; a runner who only switched
 * the HR line off (nothing hidden) still shows lap averages, as before. Synthetic data only.
 */
const ACT = '00000000-0000-4000-8000-000000000c01';
const OWNER = 'owner-athlete';
// Wave counter: a read joins the wave of reads started before any earlier read came back.
// Deterministic (no clocks), so it holds on a loaded machine.
const w = vi.hoisted(() => ({ resolved: 0, starts: [] as number[] }));
const track = vi.hoisted(() => <T,>(v: T): Promise<T> => {
  w.starts.push(w.resolved);
  return new Promise((r) => setTimeout(() => { w.resolved++; r(v); }, 1));
});
const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown },
  runnerAllowsHr: true,
}));

vi.mock('@/lib/auth/self-or-staff', async (o) => ({
  ...(await o<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: vi.fn(async () => ({ denied: null, caller: h.caller })),
}));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: vi.fn(() => track(false)), seesPending: () => false }));
vi.mock('@/lib/athletes/hr-trace-privacy', async (o) => ({
  ...(await o<typeof import('@/lib/athletes/hr-trace-privacy')>()),
  readHrTracePublic: vi.fn(() => track(h.runnerAllowsHr)),
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
vi.mock('@/lib/garmin/stream-store', () => ({ loadActivityStream: vi.fn(() => track({ series: { t: T, d: D, cad: CAD, hr: HR }, laps: LAPS })) }));
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
        limit: () => b, order: () => b, range: () => b, is: () => b,
        maybeSingle: () => track({ data: table === 'athlete_activities' ? ROW : null, error: null }),
        then: (ok: any, bad: any) => track(table === 'feed_items' ? h.feed : { data: [], error: null }).then(ok, bad),
      };
      return b;
    },
  }),
}));

const { GET } = await import('@/app/api/activities/analysis/route');

describe('activities/analysis query waves', () => {
  beforeEach(() => { w.resolved = 0; w.starts = []; h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; });
  it('a teammate opening a run costs at most 4 sequential waves', async () => {
    const res = await GET(new Request(`http://x/api/activities/analysis?activityId=${ACT}`));
    expect(res.status).toBe(200);
    const waves = new Set(w.starts).size;
    expect(waves).toBeLessThanOrEqual(4);
  });
});
