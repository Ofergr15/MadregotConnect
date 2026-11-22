import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native run-detail screen: GET /api/activities/details?activityId=.
 * The real route handler (and the real stream loader, splits binning and HR thinning) runs
 * against a fake Supabase client; only the verified-caller resolver and the DB are faked.
 * See docs/contracts/run-details.md.
 *
 * Exposure pinned here: any verified member gets the full GPS trace (2026-09-03 decision);
 * `include=hr` / `include=steps` are the run's OWN athlete only, and are silently omitted —
 * not refused — for anyone else, staff included.
 */

type Op = [string, ...unknown[]];
type Q = { table: string; ops: Op[] };
const log: Q[] = [];
let answer: (q: Q) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(table: string) {
  const q: Q = { table, ops: [] };
  log.push(q);
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'gte', 'lte', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => { q.ops.push([m, ...args]); return b; };
  }
  b.maybeSingle = async () => answer(q);
  b.single = async () => answer(q);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q)).then(res, rej);
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

type Caller = { athleteId: string | null; isStaff: boolean; isSuperUser: boolean };
let denied: { status: number; error: string } | null = { status: 401, error: 'Missing bearer token' };
let caller: Caller = { athleteId: null, isStaff: false, isSuperUser: false };
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({
    denied: denied ? new Response(JSON.stringify({ error: denied.error }), { status: denied.status }) : null,
    caller,
  }),
  mayActFor: (c: Caller, id: string | null) => !!c.isStaff || !!c.isSuperUser || (!!id && c.athleteId === id),
}));

const { GET } = await import('@/app/api/activities/details/route');

const OWNER = '11111111-1111-4111-8111-111111111111';
const MATE = '22222222-2222-4222-8222-222222222222';
const ACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GPS = [{ lat: 32.1, lng: 34.8 }, { lat: 32.101, lng: 34.801 }, { lat: 32.102, lng: 34.802 }];
const ROW = {
  id: ACT_ID, athlete_id: OWNER, source: 'garmin', strava_activity_id: null, garmin_activity_id: 987,
  activity_name: 'ריצה קלה', activity_type: 'running', start_time: '2026-11-19T06:10:00+00:00',
  distance: 2000, duration: 600, moving_duration: 600, average_pace: 300, average_hr: 150, max_hr: 170,
  calories: 150, elevation_gain: 5, start_lat: 32.1, start_lng: 34.8, avg_cadence: 172, avg_stride_length: 1.1,
  vo2max: 55, lap_count: 2, location_name: 'תל אביב', perceived_rpe: null, perceived_feel: null,
  gps_points: GPS, laps: [{ distance: 1000, duration: 300, averageHR: 148 }, { distance: 1000, duration: 300, averageHR: 152 }],
  splits: null, has_polyline: true, elapsed_duration: 640,
  athletes: { name: 'הבעלים', avatar_url: 'https://cdn/a.jpg' }, shoes: { name: 'Pegasus' },
};
const SERIES = { t: [0, 300, 600], d: [0, 1000, 2000], hr: [140, 150, 160] };

let row: unknown = ROW;
function dbAnswer(q: Q) {
  if (q.table === 'athlete_activities') {
    const sel = String(q.ops.find(([m]) => m === 'select')?.[1] ?? '');
    if (sel.includes('gps_points')) return { data: row, error: null };
    if (sel.trim() === 'executed_workout') return { data: { executed_workout: null }, error: null };
    return { data: [], error: null }; // same-day runs for the quality name
  }
  if (q.table === 'activity_streams') return { data: { activity_id: ACT_ID, series: SERIES, sample_count: 3, interval_sec: 1, metrics: ['hr'], laps: null }, error: null };
  if (q.table === 'athletes') return { data: { approved: true, group_id: null }, error: null };
  return { data: [], error: null };
}
const get = (qs: string) => GET(new Request(`http://x/api/activities/details${qs}`, { headers: { authorization: 'Bearer t' } }));
const as = (c: Partial<Caller>) => { denied = null; caller = { athleteId: null, isStaff: false, isSuperUser: false, ...c }; };

beforeEach(() => {
  log.length = 0; row = ROW; answer = dbAnswer;
  denied = { status: 401, error: 'Missing bearer token' };
  caller = { athleteId: null, isStaff: false, isSuperUser: false };
});

describe('GET /api/activities/details — errors', () => {
  it('no activityId → 400 { error: "activityId required" } (checked before auth)', async () => {
    const res = await get('');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'activityId required' });
  });
  it('no session → 401 { error }, nothing read', async () => {
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Missing bearer token' });
    expect(log).toEqual([]);
  });
  it('a session with no club membership / pending approval → 403 { error } from the session gate', async () => {
    denied = { status: 403, error: 'pending' };
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'pending' });
  });
  it('unknown activity → 404 { error: "Activity not found" }', async () => {
    as({ athleteId: MATE });
    row = null;
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Activity not found' });
  });
  it("a pending runner's run → 404 for a teammate (indistinguishable from missing)", async () => {
    as({ athleteId: MATE });
    answer = (q) => (q.table === 'athletes' ? { data: { approved: false }, error: null } : dbAnswer(q));
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(404);
  });
  it('a DB error → 500 { error }', async () => {
    as({ athleteId: MATE });
    answer = (q) => (q.table === 'athlete_activities' ? { data: null, error: { message: 'boom' } } : dbAnswer(q));
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch' }); // never the DB text
  });
});

describe('GET /api/activities/details — shape', () => {
  it('a teammate gets the run inside the privacy zone: trimmed trace, no start coordinates', async () => {
    as({ athleteId: MATE });
    const res = await get(`?activityId=${ACT_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['activity', 'gpsPoints', 'hasPolyline', 'qualityName', 'repTarget', 'source', 'splits']);
    expect(body).toMatchObject({ hasPolyline: true, source: 'garmin', qualityName: null, repTarget: null });
    // Start/finish privacy zone (route-trim.ts): a teammate never receives the first/last 200 m.
    expect(Array.isArray(body.gpsPoints)).toBe(true);
    expect(body.gpsPoints.length).toBeLessThan(GPS.length);
    expect(body.splits).toHaveLength(2);
    expect(body.splits[0]).toMatchObject({ distance: 1000, averagePace: 300 });
    // `activity` is the raw row, snake_case, minus gps_points/laps/splits and the embeds,
    // plus three flattened names.
    const { gps_points: _g, laps: _l, splits: _s, athletes: _a, shoes: _sh, ...rest } = ROW;
    expect(body.activity).toEqual({ ...rest, start_lat: null, start_lng: null, athlete_name: 'הבעלים', athlete_avatar_url: 'https://cdn/a.jpg', shoe_name: 'Pegasus' });
    // No hiddenFields on this run's feed item → nothing masked (masking is readHiddenStats, lib/activities/hidden-stats).
    expect(body.activity).toMatchObject({ average_hr: 150, max_hr: 170, calories: 150, average_pace: 300 });
    // start_time is the stored wall-clock-as-UTC string, untouched.
    expect(body.activity.start_time).toBe('2026-11-19T06:10:00+00:00');
  });
  it('no GPS → gpsPoints: [] (never null); missing source → "strava"', async () => {
    as({ athleteId: MATE });
    row = { ...ROW, gps_points: null, source: null };
    const body = await (await get(`?activityId=${ACT_ID}`)).json();
    expect(body.gpsPoints).toEqual([]);
    expect(body.source).toBe('strava');
  });
  it('a legacy numeric id is looked up by garmin_activity_id or |strava id|', async () => {
    as({ athleteId: MATE });
    await get('?activityId=987');
    const q = log.find((x) => x.table === 'athlete_activities')!;
    expect(q.ops).toContainEqual(['or', 'strava_activity_id.eq.987,garmin_activity_id.eq.987']);
  });
});

describe('GET /api/activities/details — include=hr (owner only)', () => {
  it('the owner gets hrTrace as [metres, bpm][]', async () => {
    as({ athleteId: OWNER });
    const body = await (await get(`?activityId=${ACT_ID}&include=hr`)).json();
    expect(Array.isArray(body.hrTrace)).toBe(true);
    expect(body.hrTrace.length).toBeGreaterThan(0);
    for (const p of body.hrTrace) expect(p).toEqual([expect.any(Number), expect.any(Number)]);
  });
  it('a teammate asking for include=hr,steps gets 200 with the keys ABSENT (not null, not 403)', async () => {
    as({ athleteId: MATE });
    const res = await get(`?activityId=${ACT_ID}&include=hr,steps`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect('hrTrace' in body).toBe(false);
    expect('stepBands' in body).toBe(false);
  });
  it('staff are not the owner either: no hrTrace for a coach', async () => {
    as({ athleteId: null, isStaff: true });
    const body = await (await get(`?activityId=${ACT_ID}&include=hr`)).json();
    expect('hrTrace' in body).toBe(false);
  });
});
