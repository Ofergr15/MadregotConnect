import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start coordinates on the run detail (2026-11-22): a non-owner, non-staff viewer gets
 * start_lat/start_lng null — the whole JSON is searched for the exact values. Owner and
 * staff keep them. Harness copied from hiddenStatsDetailsStream.test.ts.
 *
 * (Original harness note:) Hidden stats (share sheet "פרטים מוסתרים", feed_items.payload.hiddenFields) on the run
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
  start_lat: 32.0853, start_lng: 34.7818, location_name: 'Tel Aviv',
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

async function details() {
  const { GET } = await import('@/app/api/activities/details/route');
  const res = await GET(new Request(`http://x/api/activities/details?activityId=${ACT}`));
  return { status: res.status, text: await res.text() };
}

beforeEach(() => { h.feed = { data: [], error: null }; h.pending = false; h.runnerAllowsHr = false; });

describe('activities/details — start coordinates', () => {
  it('teammate: no exact start coordinate anywhere in the JSON; place name stays', async () => {
    asTeammate();
    const { status, text } = await details();
    expect(status).toBe(200);
    expect(text).not.toContain('32.0853');
    expect(text).not.toContain('34.7818');
    const body = JSON.parse(text);
    expect(body.activity.start_lat).toBeNull();
    expect(body.activity.start_lng).toBeNull();
    expect(body.activity.location_name).toBe('Tel Aviv');
  });
  it('owner keeps the coordinates', async () => {
    asOwner();
    const body = JSON.parse((await details()).text);
    expect(body.activity).toMatchObject({ start_lat: 32.0853, start_lng: 34.7818 });
  });
  it('staff keeps the coordinates', async () => {
    asStaff();
    const body = JSON.parse((await details()).text);
    expect(body.activity).toMatchObject({ start_lat: 32.0853, start_lng: 34.7818 });
  });
});
