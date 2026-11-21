import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hidden stats (share sheet "פרטים מוסתרים", feed_items.payload.hiddenFields) on the run
 * detail and trace routes, through the real handlers. Owner-approved scope 2026-11-21:
 * pace / heart rate / calories withheld from members who are not the runner and not
 * staff; the runner and staff keep everything; distance and time totals stay; the HR
 * trace consent rule and the pending-runner 404 are unchanged; a failed hidden-fields read
 * hides everything. Synthetic ids and rows only.
 */
const ACT = '00000000-0000-4000-8000-0000000000a1';
const OWNER = 'owner-athlete';

const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown },
  pending: false,
  runnerAllowsHr: false,
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
const t = Array.from({ length: 1500 }, (_, i) => i);
vi.mock('@/lib/garmin/stream-store', () => ({
  loadActivityStream: vi.fn(async () => ({
    series: { t, d: t.map((s) => s * 3.3), v: t.map(() => 330), hr: t.map(() => 150), cad: t.map(() => 176) },
    laps: [{ distance: 2500, duration: 760, averagePace: 304, averageHR: 148 }, { distance: 2450, duration: 740, averagePace: 302, averageHR: 152 }],
  })),
}));
vi.mock('@/lib/activities/quality-name', () => ({ qualityNames: vi.fn(async () => new Map()) }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({ groupNumberForAthlete: vi.fn(async () => 1) }));

const ROW = {
  id: ACT, athlete_id: OWNER, source: 'strava', activity_name: 'Easy', activity_type: 'running',
  start_time: '2026-11-19T06:00:00+00:00', distance: 5000, duration: 1500, moving_duration: 1500,
  average_pace: 300, average_hr: 151, max_hr: 172, calories: 410, gps_points: [], laps: [], has_polyline: false,
  splits: [{ distance: 1000, duration: 300, averageHR: 150 }, { distance: 1000, duration: 302, averageHR: 152 }],
  athletes: { name: 'Owner', avatar_url: null }, shoes: null, elapsed_duration: 1500,
};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b, eq: () => b, or: () => b, gte: () => b, lte: () => b, in: () => b, limit: () => b, order: () => b,
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

async function details() {
  const { GET } = await import('@/app/api/activities/details/route');
  const res = await GET(new Request(`http://x/api/activities/details?activityId=${ACT}`));
  return { status: res.status, body: await res.json() };
}
async function stream() {
  const { GET } = await import('@/app/api/activities/stream/route');
  const res = await GET(new Request(`http://x/api/activities/stream?activityId=${ACT}`));
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') };
}

beforeEach(() => { h.feed = { data: [], error: null }; h.pending = false; h.runnerAllowsHr = false; });

describe('activities/details — hidden pace, heart rate, calories', () => {
  it('teammate: hidden stats are null (avg pace, avg/max HR, calories, per-km pace/duration/HR); distance and time stay', async () => {
    asTeammate(); hide('pace', 'heart_rate', 'calories');
    const { status, body } = await details();
    expect(status).toBe(200);
    expect(body.activity).toMatchObject({ average_pace: null, average_hr: null, max_hr: null, calories: null, distance: 5000, duration: 1500, moving_duration: 1500 });
    for (const s of body.splits) { expect(s.averagePace).toBeNull(); expect(s.duration).toBeNull(); expect(s.averageHR).toBeNull(); expect(s.distance).toBeGreaterThan(0); }
  });
  it('teammate: only the hidden key is masked', async () => {
    asTeammate(); hide('calories');
    const { body } = await details();
    expect(body.activity).toMatchObject({ calories: null, average_pace: 300, average_hr: 151, max_hr: 172 });
    expect(body.splits[0].averagePace).not.toBeNull();
  });
  it.each([['owner', asOwner], ['staff', asStaff]])('%s sees everything despite hidden stats', async (_n, as) => {
    as(); hide('pace', 'heart_rate', 'calories');
    const { body } = await details();
    expect(body.activity).toMatchObject({ average_pace: 300, average_hr: 151, max_hr: 172, calories: 410 });
    expect(body.splits[0].averagePace).not.toBeNull();
  });
  it('teammate with no feed item: nothing was hidden, nothing is masked', async () => {
    asTeammate();
    const { body } = await details();
    expect(body.activity).toMatchObject({ average_pace: 300, average_hr: 151, calories: 410 });
  });
  it('teammate when the hidden-fields read fails: fails closed (all three masked)', async () => {
    asTeammate(); h.feed = { data: null as never, error: { message: 'boom' } };
    const { body } = await details();
    expect(body.activity).toMatchObject({ average_pace: null, average_hr: null, max_hr: null, calories: null, distance: 5000 });
  });
  it('pending runner still reads as 404 to a teammate (unchanged)', async () => {
    asTeammate(); h.pending = true;
    expect((await details()).status).toBe(404);
  });
});

describe('activities/stream — hidden pace and heart rate', () => {
  it('teammate, pace hidden: no pace line, no elapsed-time axis, per-km and per-lap pace/duration null; distance axis stays', async () => {
    asTeammate(); hide('pace');
    const { body } = await stream();
    expect(body.stream.pace.every((p: unknown) => p == null)).toBe(true);
    expect(body.stream.t).toEqual([]);
    expect(body.stream.d.length).toBeGreaterThan(0);
    for (const k of body.kmSplits) { expect(k.pace).toBeNull(); expect(k.duration).toBeNull(); expect(k.distance).toBeGreaterThan(0); }
    for (const l of body.laps) { expect(l.pace).toBeNull(); expect(l.duration).toBeNull(); expect(l.distance).toBeGreaterThan(0); }
  });
  it('teammate, heart rate hidden: no HR line or zones (as before) AND per-km / per-lap HR null', async () => {
    asTeammate(); hide('heart_rate'); h.runnerAllowsHr = true;
    const { body } = await stream();
    expect(body.hrVisible).toBe(false);
    expect(body.stream.hr).toBeUndefined();
    expect(body.zones).toBeNull();
    expect(body.kmSplits.every((k: { hr: unknown }) => k.hr == null)).toBe(true);
    expect(body.laps.every((l: { hr: unknown }) => l.hr == null)).toBe(true);
    expect(body.stream.pace.some((p: unknown) => p != null)).toBe(true);    // pace not hidden: kept
  });
  it('HR trace consent unchanged: nothing hidden, runner allows → teammate sees the HR line', async () => {
    asTeammate(); h.runnerAllowsHr = true;
    const { body } = await stream();
    expect(body.hrVisible).toBe(true);
    expect(body.stream.hr?.length).toBeGreaterThan(0);
  });
  it('HR trace consent unchanged: runner does not allow → no HR line, but per-km HR averages stay when HR is not hidden', async () => {
    asTeammate();
    const { body } = await stream();
    expect(body.hrVisible).toBe(false);
    expect(body.kmSplits.some((k: { hr: unknown }) => k.hr != null)).toBe(true);
  });
  it.each([['owner', asOwner], ['staff', asStaff]])('%s sees pace and HR despite hidden stats', async (_n, as) => {
    as(); hide('pace', 'heart_rate');
    const { body } = await stream();
    expect(body.hrVisible).toBe(true);
    expect(body.stream.t.length).toBeGreaterThan(0);
    expect(body.stream.pace.some((p: unknown) => p != null)).toBe(true);
  });
  it('teammate when the hidden-fields read fails: fails closed (no pace, no HR)', async () => {
    asTeammate(); h.runnerAllowsHr = true; h.feed = { data: null as never, error: { message: 'boom' } };
    const { body } = await stream();
    expect(body.hrVisible).toBe(false);
    expect(body.stream.t).toEqual([]);
  });
  it('cache scope unchanged: private, per viewer', async () => {
    asTeammate(); hide('pace');
    expect((await stream()).cache).toBe('private, max-age=300');
  });
  it('pending runner still reads as 404 to a teammate (unchanged)', async () => {
    asTeammate(); h.pending = true;
    expect((await stream()).status).toBe(404);
  });
});
