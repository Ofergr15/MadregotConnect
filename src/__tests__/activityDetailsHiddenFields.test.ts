// P1: GET /api/activities/details honours the athlete's hidden fields for every
// viewer but the athlete. FIXTURE only: a fake query builder, no real DB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const RUN = {
  id: '00000000-0000-4000-8000-0000000000aa', athlete_id: 'owner', source: 'garmin', strava_activity_id: null, garmin_activity_id: 1,
  activity_name: 'Run', activity_type: 'running', start_time: '2026-11-20T06:00:00', distance: 10000, duration: 3000,
  moving_duration: 3000, average_pace: 300, average_hr: 150, max_hr: 175, calories: 700, elevation_gain: 10,
  start_lat: 32, start_lng: 34, avg_cadence: 170, avg_stride_length: 1, vo2max: null, lap_count: 2, location_name: null,
  perceived_rpe: null, perceived_feel: null, gps_points: [{ lat: 32, lng: 34 }], has_polyline: true,
  splits: null,
  laps: [
    { distance: 5000, duration: 1500, averageHR: 148, startTimeGMT: '2026-11-20T06:00:00' },
    { distance: 5000, duration: 1500, averageHR: 152, startTimeGMT: '2026-11-20T06:25:00' },
  ],
  athletes: { name: 'Owner', avatar_url: null },
};
let payload: Record<string, unknown> | null = null;
let feedFails = false;
function builder(table: string) {
  const b: any = new Proxy({}, {
    get(_, k) {
      if (k === 'then') return (res: any) => res({ data: table === 'groups' ? [] : null, error: null });
      if (k === 'maybeSingle') return async () => {
        if (table === 'athlete_activities') return { data: RUN, error: null };
        if (table === 'feed_items') { if (feedFails) throw new Error('down'); return { data: payload ? { payload } : null, error: null }; }
        return { data: null, error: null };
      };
      return () => b;
    },
  });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => builder(t) }) }));
let caller: any = null;
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<typeof import('@/lib/auth/self-or-staff')>()), resolveVerifiedCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: async () => false, seesPending: () => true }));
vi.mock('@/lib/garmin/stream-store', () => ({ loadActivityStream: async () => null }));
vi.mock('@/lib/activities/quality-name', () => ({ qualityNames: async () => new Map() }));

const as = (athleteId: string, isStaff = false) => ({ athleteId, isStaff, isSuperUser: false, email: 'x@example.test', role: isStaff ? 'coach' : 'runner' });
const get = async () => {
  const { GET } = await import('@/app/api/activities/details/route');
  const res = await GET(new Request(`http://x/api/activities/details?activityId=${RUN.id}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { payload = null; feedFails = false; });

describe('activity details: hidden fields', () => {
  it('nothing hidden: a teammate sees the stats and per-km splits', async () => {
    caller = as('mate');
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.activity).toMatchObject({ average_hr: 150, max_hr: 175, calories: 700, average_pace: 300 });
    expect(r.body.splits.length).toBeGreaterThan(0);
  });
  it('all hidden: a TEAMMATE gets nulls and no splits; route data is untouched', async () => {
    payload = { hiddenFields: ['calories', 'heart_rate', 'pace'] };
    caller = as('mate');
    const r = await get();
    expect(r.body.activity).toMatchObject({ average_hr: null, max_hr: null, calories: null, average_pace: null });
    expect(r.body.splits).toEqual([]);
    expect(r.body.gpsPoints).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toMatch(/"averageHR":1[45]\d/);
  });
  it('STAFF are masked too (current policy: no coach exemption)', async () => {
    payload = { hiddenFields: ['heart_rate'] };
    caller = as('coach', true);
    const r = await get();
    expect(r.body.activity).toMatchObject({ average_hr: null, max_hr: null, calories: 700, average_pace: 300 });
    expect(r.body.splits.every((s: any) => s.averageHR === null)).toBe(true);
  });
  it('the ATHLETE always sees their own full numbers', async () => {
    payload = { hiddenFields: ['calories', 'heart_rate', 'pace'] };
    caller = as('owner');
    const r = await get();
    expect(r.body.activity).toMatchObject({ average_hr: 150, calories: 700, average_pace: 300 });
    expect(r.body.splits.length).toBeGreaterThan(0);
  });
  it('the feed read failing hides all three (fail closed)', async () => {
    feedFails = true;
    caller = as('mate');
    const r = await get();
    expect(r.body.activity).toMatchObject({ average_hr: null, calories: null, average_pace: null });
    expect(r.body.splits).toEqual([]);
  });
  it('unknown keys in hiddenFields are ignored', async () => {
    payload = { hiddenFields: ['nonsense'] };
    caller = as('mate');
    expect((await get()).body.activity.average_hr).toBe(150);
  });
});
