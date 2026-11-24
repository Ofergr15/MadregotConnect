import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hidden stats on /api/activities/analysis, through the real handler. A teammate with pace
 * hidden gets no rep paces, best efforts, records, similar sessions' pace or heat cost; a
 * hidden heart rate now closes the HR trace here as it does on /stream; the runner and staff
 * keep everything; a failed hidden-fields read hides all. The workout reader, best-effort and
 * PR helpers are stubbed: this pins the route's masking, not the analytics. Synthetic data.
 */
const ACT = '00000000-0000-4000-8000-0000000000b2';
const OWNER = 'owner-athlete';
const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown },
  runnerAllowsHr: true,
  pending: false,
  athlete: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: vi.fn(async () => ({ denied: null, caller: h.caller })),
}));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: vi.fn(async () => h.pending), seesPending: () => false }));
vi.mock('@/lib/athletes/hr-trace-privacy', async (orig) => ({
  ...(await orig<typeof import('@/lib/athletes/hr-trace-privacy')>()),
  readHrTracePublic: vi.fn(async () => h.runnerAllowsHr),
}));
const t = Array.from({ length: 1300 }, (_, i) => i);
vi.mock('@/lib/garmin/stream-store', () => ({
  loadActivityStream: vi.fn(async () => ({ series: { t, d: t.map((s) => s * 4), hr: t.map(() => 160) }, laps: [] })),
}));
vi.mock('@/lib/run-analysis/workout', () => ({
  readWorkout: () => {
    const rep = { kind: 'rep', meters: 1000, start: 100, seconds: 225, pace: 225, hr: 170, maxHr: 181 };
    return { title: '5×1000', avgPace: 225, avgHr: 170, segments: [rep], reps: [rep], strides: [] };
  },
  bestEffort: () => ({ seconds: 220, start: 100 }),
  heatCostSec: () => 6,
  recoveries: (tr: { hr?: number[] }) => (tr.hr ? [{ rep: 1, from: 170, to: 130 }] : []),
  technique: () => [{ rep: 1, cadence: 182, stride: 1.4 }],
}));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: vi.fn(async () => []) }));
vi.mock('@/lib/prs/pr-buckets', () => ({ filterQualifyingRuns: (x: unknown) => x, computeDistanceBests: () => [{ key: '5k', seconds: 1150, date: '2026-10-01' }] }));
vi.mock('@/lib/prs/attach-laps', () => ({ attachLapsForPrs: vi.fn(async (_db: unknown, _id: unknown, r: unknown) => r) }));
vi.mock('@/lib/prs/overrides', () => ({ applyPrOverrides: (b: unknown) => b }));
vi.mock('@/lib/prs/overrides-store', () => ({ readPrOverrides: vi.fn(async () => []) }));
vi.mock('@/lib/prs/exclusions-store', () => ({ readPrExclusions: vi.fn(async () => []) }));

const ROW = { id: ACT, athlete_id: OWNER, start_time: '2026-11-19T06:00:00+00:00', distance: 5200, duration: 1300, average_pace: 250,
  start_lat: 32.1, start_lng: 34.8, laps: [], executed_workout: { steps: [] } };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b, eq: () => b, neq: () => b, not: () => b, or: () => b, gte: () => b, lte: () => b, lt: () => b,
        in: () => b, limit: () => b, order: () => b, range: () => b,
        maybeSingle: async () => (table === 'athletes' ? h.athlete : { data: table === 'athlete_activities' ? { ...ROW, training_effect: { aerobic: 3.1 } } : null, error: null }),
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

async function analysis() {
  const { GET } = await import('@/app/api/activities/analysis/route');
  const res = await GET(new Request(`http://x/api/activities/analysis?activityId=${ACT}`));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  h.feed = { data: [], error: null }; h.runnerAllowsHr = true; h.pending = false; h.athlete = { data: { default_hidden_fields: [] }, error: null };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hourly: {
    time: ['2026-11-19T06:00'], temperature_2m: [22], relative_humidity_2m: [70], dew_point_2m: [16], apparent_temperature: [23] } }), { status: 200 })));
});

describe('activities/analysis — hidden stats', () => {
  it('teammate, pace hidden: workout, efforts, records, similar and heat cost withheld; weather, cadence/stride, HR recovery, training effect stay', async () => {
    asTeammate(); hide('pace');
    const { status, body } = await analysis();
    expect(status).toBe(200);
    expect(body.workout).toBeNull();
    expect(body.efforts).toEqual([]);
    expect(body.prs).toEqual({});
    expect(body.similar).toEqual([]);
    expect(body.conditions).toMatchObject({ tempC: 22, dewC: 16, costSec: null, calc: false });
    expect(body.technique).toEqual([{ rep: 1, cadence: 182, stride: 1.4 }]);
    expect(body.recovery.length).toBe(1);
    expect(body.trainingEffect).toEqual({ aerobic: 3.1 });
    expect(body.hrVisible).toBe(true);
  });
  it('teammate, heart rate hidden: HR trace closed even though the runner allows it (as /stream already did)', async () => {
    asTeammate(); hide('heart_rate');
    const { body } = await analysis();
    expect(body.hrVisible).toBe(false);
    expect(body.recovery).toEqual([]);
    expect(body.workout).not.toBeNull();                       // pace not hidden: kept
    expect(body.workout.avgHr).toBeNull();                     // ...but its lap HR goes with hidden HR
    expect(body.workout.reps[0]).toMatchObject({ hr: null, maxHr: null, pace: 225 });
  });
  it('teammate, nothing hidden: unchanged (workout, efforts, heat cost present)', async () => {
    asTeammate();
    const { body } = await analysis();
    expect(body.workout).not.toBeNull();
    expect(body.efforts.length).toBeGreaterThan(0);
    expect(body.conditions.costSec).toBe(6);
  });
  it.each([['owner', asOwner], ['staff', asStaff]])('%s sees everything despite hidden pace and HR', async (_n, as) => {
    as(); hide('pace', 'heart_rate'); h.runnerAllowsHr = false;
    const { body } = await analysis();
    expect(body.workout).not.toBeNull();
    expect(body.efforts.length).toBeGreaterThan(0);
    expect(body.hrVisible).toBe(true);
  });
  it('teammate when the hidden-fields read fails: fails closed (pace blocks withheld, HR closed)', async () => {
    asTeammate(); h.feed = { data: null as never, error: { message: 'boom' } };
    const { body } = await analysis();
    expect(body.workout).toBeNull();
    expect(body.hrVisible).toBe(false);
  });
  it('pending runner still reads as 404 to a teammate (unchanged)', async () => {
    asTeammate(); h.pending = true;
    expect((await analysis()).status).toBe(404);
  });
});

// 2026-11-23: a runner who hides pace in their settings hides their record TIMES from
// teammates even on a run whose own pace they left visible (lib/records/pace-privacy.ts).
describe('activities/analysis — record times of a pace-hider', () => {
  const setting = (f: string[]) => { h.athlete = { data: { default_hidden_fields: f }, error: null }; };
  it('teammate: records withheld and flagged; the run\'s own pace blocks stay', async () => {
    asTeammate(); setting(['pace']);
    const { body } = await analysis();
    expect(body.prs).toEqual({});
    expect(body.prsPaceHidden).toBe(true);
    expect(body.workout).not.toBeNull();
  });
  it.each([['owner', asOwner], ['staff', asStaff]])('%s sees the records', async (_n, as) => {
    as(); setting(['pace']);
    expect((await analysis()).body.prs['5k']).toMatchObject({ seconds: 1150 });
  });
  it('teammate of a runner who does not hide pace sees the records', async () => {
    asTeammate(); setting(['calories']);
    expect((await analysis()).body.prs['5k']).toMatchObject({ seconds: 1150 });
  });
  it('a failed read of the setting withholds them', async () => {
    asTeammate(); h.athlete = { data: null, error: { code: 'XX000' } };
    expect((await analysis()).body.prs).toEqual({});
  });
});
