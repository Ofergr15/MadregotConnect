import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { serializeWatchWorkout } from '@/lib/watch/serialize';
import { intervals } from './fixtures/watch-workouts';

/**
 * The /api/device routes end to end against an in-memory database: register →
 * token → pending → ack → upload, the pre-136 answer, and the auth edges.
 */

const h = vi.hoisted(() => ({
  db: null as any,
  session: { ok: true, user: { athleteId: 'ath-1', viewingAsBy: undefined as string | undefined } } as any,
}));

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => h.db.client }));
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: async () => h.session,
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/plans/match-athlete-activities', () => ({ matchAthleteActivities: async () => ({ matched: 0, plans: 0 }) }));
vi.mock('@/lib/badges/award-engine', () => ({ checkAndAwardBadges: async () => ({ awarded: [] }) }));
vi.mock('@/lib/challenges/engine', () => ({ checkAndAwardChallenges: async () => ({ awarded: [] }) }));
vi.mock('@/lib/shoes', () => ({ checkShoeAlert: async () => undefined }));

import { POST as register } from '@/app/api/device/register/route';
import { POST as token } from '@/app/api/device/token/route';
import { POST as revoke } from '@/app/api/device/revoke/route';
import { GET as pending } from '@/app/api/device/pending-workouts/route';
import { POST as ack } from '@/app/api/device/deliveries/ack/route';
import { POST as upload } from '@/app/api/device/activities/route';
import { resetWatchSchemaCache } from '@/lib/watch/schema';
import { ACCESS_TTL_MS } from '@/lib/watch/device-auth';
import { israelToday } from '@/lib/utils';
import { addDays } from '@/lib/watch/pending';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const SCHEMA_136 = {
  athletes: ['id', 'name', 'status', 'active_shoe_id', 'max_hr_bpm', 'group_id'],
  athlete_devices: ['id', 'athlete_id', 'platform', 'installation_id', 'device_name', 'app_version', 'os_version', 'apns_token', 'scheduler_authorized', 'health_authorized', 'last_seen_at', 'created_at', 'revoked_at'],
  device_tokens: ['id', 'device_id', 'token_hash', 'created_at', 'expires_at', 'used_at', 'replaced_by', 'revoked_at'],
  workout_deliveries: ['id', 'plan_id', 'athlete_id', 'workout_date', 'workout_data', 'garmin_workout_id', 'status', 'error_message', 'created_at', 'workout_key', 'device_confirmed_at', 'provider', 'provider_plan_id', 'superseded_at', 'removed_at'],
  athlete_activities: ['id', 'athlete_id', 'garmin_activity_id', 'strava_activity_id', 'source', 'apple_workout_uuid', 'provider_plan_id', 'activity_name', 'activity_type', 'start_time', 'distance', 'duration', 'average_pace', 'average_hr', 'max_hr', 'calories', 'elevation_gain', 'avg_cadence', 'start_lat', 'start_lng', 'end_lat', 'end_lng', 'gps_points', 'has_polyline', 'laps', 'lap_count', 'shoe_id', 'created_at'],
  activity_plan_matches: ['id', 'activity_id', 'workout_key', 'match_method', 'weekly_plan_id'],
  activity_streams: ['id', 'activity_id', 'garmin_activity_id', 'source', 'sample_count', 'interval_sec', 'metrics', 'series', 'laps', 'unit_correction', 'fetched_at', 'created_at'],
};
const PRE_136 = {
  athletes: SCHEMA_136.athletes,
  workout_deliveries: SCHEMA_136.workout_deliveries.filter((c) => !['provider', 'provider_plan_id', 'superseded_at', 'removed_at'].includes(c)),
  athlete_activities: SCHEMA_136.athlete_activities.filter((c) => !['apple_workout_uuid', 'provider_plan_id'].includes(c)),
};

function freshDb(schema: Record<string, string[]> = SCHEMA_136) {
  const db = createMemoryDb({
    schema,
    unique: {
      device_tokens: [['token_hash']],
      athlete_activities: [['athlete_id', 'garmin_activity_id'], ['athlete_id', 'apple_workout_uuid']],
      workout_deliveries: [['provider_plan_id']],
    },
    defaults: { workout_deliveries: () => ({ provider: 'garmin', status: 'pending' }) },
  });
  db.tables.athletes.push({ id: 'ath-1', name: 'Runner', status: 'active', active_shoe_id: null, max_hr_bpm: 190 });
  db.tables.athletes.push({ id: 'ath-2', name: 'Other', status: 'active' });
  return db;
}

const req = (url: string, body?: unknown, auth?: string, method = 'POST') =>
  new Request(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function registered(installationId = 'inst-1') {
  const res = await register(req('/api/device/register', { platform: 'ios', installationId, appVersion: '0.1', schedulerAuthorized: true, healthAuthorized: true }, 'supabase-jwt'));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ deviceId: string; refreshToken: string; accessToken: string; accessTokenExpiresAt: string }>;
}

beforeEach(() => {
  resetWatchSchemaCache();
  h.db = freshDb();
  h.session = { ok: true, user: { athleteId: 'ath-1', viewingAsBy: undefined } };
});

describe('before migration 136 every device route is a 404', () => {
  it('answers watch-not-enabled and writes nothing', async () => {
    h.db = freshDb(PRE_136);
    const calls = [
      register(req('/api/device/register', { installationId: 'i' }, 'jwt')),
      token(req('/api/device/token', { refreshToken: 'wrt1.x' })),
      revoke(req('/api/device/revoke', { refreshToken: 'wrt1.x' })),
      pending(req('/api/device/pending-workouts', undefined, 'wat1.x', 'GET')),
      ack(req('/api/device/deliveries/ack', { scheduled: [] }, 'wat1.x')),
      upload(req('/api/device/activities', {}, 'wat1.x')),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'watch-not-enabled' });
    }
    expect(h.db.log.filter((q: any) => q.op !== 'select')).toEqual([]);
  });
});

describe('register', () => {
  it('needs a signed-in athlete, returns the refresh token once, stores only its hash', async () => {
    const r = await registered();
    expect(r.refreshToken).toMatch(/^wrt1\./);
    expect(r.accessToken).toMatch(/^wat1\./);
    const stored = h.db.tables.device_tokens[0];
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h.db.tables)).not.toContain(r.refreshToken);
    expect(h.db.tables.athlete_devices[0]).toMatchObject({ athlete_id: 'ath-1', scheduler_authorized: true, health_authorized: true, app_version: '0.1' });
  });

  it('refuses without a session, under view-as, and without an installation id', async () => {
    h.session = { ok: false, status: 401, error: 'Missing bearer token' };
    expect((await register(req('/api/device/register', { installationId: 'i' }))).status).toBe(401);
    h.session = { ok: true, user: { athleteId: 'ath-1', viewingAsBy: 'super@x' } };
    expect((await register(req('/api/device/register', { installationId: 'i' }, 'jwt'))).status).toBe(403);
    h.session = { ok: true, user: { athleteId: 'ath-1' } };
    expect((await register(req('/api/device/register', {}, 'jwt'))).status).toBe(400);
    expect((await register(req('/api/device/register', { installationId: 'i', platform: 'android' }, 'jwt'))).status).toBe(400);
  });

  it('re-registering the same installation retires the old device and its tokens', async () => {
    const first = await registered('same');
    const second = await registered('same');
    const devices = h.db.tables.athlete_devices;
    expect(devices.find((d: any) => d.id === first.deviceId).revoked_at).toBeTruthy();
    expect(devices.find((d: any) => d.id === second.deviceId).revoked_at).toBeFalsy();
    expect((await token(req('/api/device/token', { refreshToken: first.refreshToken }))).status).toBe(401);
  });

  it('keeps at most five live devices', async () => {
    for (let i = 0; i < 7; i++) await registered(`inst-${i}`);
    expect(h.db.tables.athlete_devices.filter((d: any) => !d.revoked_at)).toHaveLength(5);
  });
});

describe('token rotation', () => {
  it('exchanges a refresh token for an access token and the next refresh token', async () => {
    const r = await registered();
    const res = await token(req('/api/device/token', { refreshToken: r.refreshToken, apnsToken: 'AB'.repeat(32), appVersion: '0.2' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refreshToken).not.toBe(r.refreshToken);
    expect(body.accessToken).toMatch(/^wat1\./);
    expect(h.db.tables.athlete_devices[0]).toMatchObject({ apns_token: 'ab'.repeat(32), app_version: '0.2' });
    // The new one works.
    expect((await token(req('/api/device/token', { refreshToken: body.refreshToken }))).status).toBe(200);
  });

  it('a lost answer can be retried inside the grace window', async () => {
    const r = await registered();
    const first = await (await token(req('/api/device/token', { refreshToken: r.refreshToken }))).json();
    const retry = await token(req('/api/device/token', { refreshToken: r.refreshToken }));
    expect(retry.status).toBe(200);
    const again = await retry.json();
    // The answer that was lost is dead; the retried one is live.
    expect((await token(req('/api/device/token', { refreshToken: first.refreshToken }))).status).toBe(401);
    expect((await token(req('/api/device/token', { refreshToken: again.refreshToken }))).status).toBe(200);
  });

  it('reuse after the successor was used revokes the whole device', async () => {
    const r = await registered();
    const next = await (await token(req('/api/device/token', { refreshToken: r.refreshToken }))).json();
    await token(req('/api/device/token', { refreshToken: next.refreshToken }));
    const stolen = await token(req('/api/device/token', { refreshToken: r.refreshToken }));
    expect(stolen.status).toBe(401);
    expect((await stolen.json()).error).toBe('refresh-reused');
    expect(h.db.tables.athlete_devices[0].revoked_at).toBeTruthy();
    expect((await pending(req('/api/device/pending-workouts', undefined, r.accessToken, 'GET'))).status).toBe(401);
  });

  it('unknown and malformed tokens are 401/400, deactivated athletes 403', async () => {
    expect((await token(req('/api/device/token', { refreshToken: 'wrt1.nope' }))).status).toBe(401);
    expect((await token(req('/api/device/token', {}))).status).toBe(400);
    const r = await registered();
    h.db.tables.athletes[0].status = 'disconnected';
    expect((await token(req('/api/device/token', { refreshToken: r.refreshToken }))).status).toBe(403);
  });
});

describe('requireDevice', () => {
  it('rejects a Supabase JWT, a forged token, an expired one, and a revoked device', async () => {
    const r = await registered();
    expect((await pending(req('/api/device/pending-workouts', undefined, 'eyJhbGciOi.x.y', 'GET'))).status).toBe(401);
    const forged = `${r.accessToken.slice(0, -4)}AAAA`;
    expect((await pending(req('/api/device/pending-workouts', undefined, forged, 'GET'))).status).toBe(401);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + ACCESS_TTL_MS + 1000);
    expect((await pending(req('/api/device/pending-workouts', undefined, r.accessToken, 'GET'))).status).toBe(401);
    vi.useRealTimers();
    expect((await revoke(req('/api/device/revoke', undefined, r.accessToken))).status).toBe(200);
    expect((await pending(req('/api/device/pending-workouts', undefined, r.accessToken, 'GET'))).status).toBe(401);
  });

  it('a deactivated athlete is locked out at once, not after 15 minutes', async () => {
    const r = await registered();
    h.db.tables.athletes[0].status = 'removed';
    expect((await pending(req('/api/device/pending-workouts', undefined, r.accessToken, 'GET'))).status).toBe(403);
  });
});

describe('pending → ack', () => {
  const today = israelToday();
  function queue(over: Record<string, unknown> = {}) {
    const row = {
      id: `d0000000-0000-4000-8000-${String(h.db.tables.workout_deliveries.length).padStart(12, '0')}`,
      plan_id: 'p-1', athlete_id: 'ath-1', workout_date: today, workout_key: 'day-2-part-1-single',
      workout_data: serializeWatchWorkout(intervals), status: 'pending', provider: 'apple',
      provider_plan_id: `9b2f6a3e-0000-4000-8000-${String(h.db.tables.workout_deliveries.length).padStart(12, '0')}`,
      superseded_at: null, removed_at: null, ...over,
    };
    h.db.tables.workout_deliveries.push(row);
    return row;
  }

  it('lists only this athlete\'s live Apple rows inside the window, earliest first', async () => {
    const r = await registered();
    const a = queue({ workout_date: addDays(today, 3) });
    const b = queue();
    queue({ workout_date: addDays(today, 9) });                   // outside the window
    queue({ athlete_id: 'ath-2' });                                // someone else
    queue({ provider: 'garmin', provider_plan_id: null });          // Garmin row
    const gone = queue({ superseded_at: new Date().toISOString(), status: 'success' });
    const res = await pending(req('/api/device/pending-workouts', undefined, r.accessToken, 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workouts.map((w: any) => w.deliveryId)).toEqual([b.id, a.id]);
    expect(body.workouts[0]).toMatchObject({ planId: b.provider_plan_id, status: 'pending', scheduledAt: { date: today, hour: 6, minute: 0 } });
    expect(body.workouts[0].workout.schema).toBe('madregot.watch-workout');
    expect(body.remove).toEqual([{ deliveryId: gone.id, planId: gone.provider_plan_id, date: today }]);
    expect(body.maxScheduled).toBe(15);
  });

  it('ack moves only the caller\'s rows: scheduled → success, removed → removed_at, failed → failed', async () => {
    const r = await registered();
    const a = queue();
    const b = queue();
    const theirs = queue({ athlete_id: 'ath-2' });
    const gone = queue({ superseded_at: new Date().toISOString(), status: 'success' });
    const res = await ack(req('/api/device/deliveries/ack', {
      scheduled: [a.id, theirs.id, 'not-a-uuid'],
      removed: [gone.id],
      failed: [{ deliveryId: b.id, error: 'SpeedRangeAlert not supported' }],
    }, r.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scheduled: 1, removed: 1, failed: 1 });
    const byId = (id: string) => h.db.tables.workout_deliveries.find((d: any) => d.id === id);
    expect(byId(a.id).status).toBe('success');
    expect(byId(theirs.id).status).toBe('pending');
    expect(byId(gone.id).removed_at).toBeTruthy();
    expect(byId(b.id)).toMatchObject({ status: 'failed', error_message: 'apple: SpeedRangeAlert not supported' });
    // A superseded row can't be "scheduled" back to life.
    const again = await (await ack(req('/api/device/deliveries/ack', { scheduled: [gone.id] }, r.accessToken))).json();
    expect(again.scheduled).toBe(0);
  });
});

describe('activity upload', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    schema: 'madregot.apple-activity', version: 1,
    appleWorkoutUuid: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    workoutPlanId: null,
    startDate: '2026-10-08T03:30:00Z', endDate: '2026-10-08T04:20:00Z', timeZone: 'Asia/Jerusalem',
    distanceM: 10020, durationS: 2980, avgHr: 151.4, maxHr: 176,
    laps: [{ startOffsetS: 0, durationS: 300, distanceM: 1000, avgHr: 140 }, { startOffsetS: 300, durationS: 290, distanceM: 1000, avgHr: 150 }],
    route: Array.from({ length: 30 }, (_, i) => ({ t: i * 100, lat: 32.08 + i * 0.003, lng: 34.78, alt: 10 })),
    heartRate: Array.from({ length: 30 }, (_, i) => ({ t: i * 100, bpm: 140 + i })),
    ...over,
  });

  it('stores one row on the athlete\'s wall clock, then answers duplicate on a resend', async () => {
    const r = await registered();
    const first = await upload(req('/api/device/activities', run(), r.accessToken));
    expect(first.status).toBe(201);
    const a = await first.json();
    expect(a.status).toBe('inserted');
    const second = await upload(req('/api/device/activities', run(), r.accessToken));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'duplicate', activityId: a.activityId });
    const rows = h.db.tables.athlete_activities;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'apple', start_time: '2026-10-08T06:30:00Z', distance: 10020, duration: 2980,
      average_hr: 151, has_polyline: true, lap_count: 2,
    });
    expect(rows[0].garmin_activity_id).toBeLessThan(-(2 ** 52) + 1);
    expect(Number.isSafeInteger(rows[0].garmin_activity_id)).toBe(true);
    expect(h.db.tables.activity_streams).toHaveLength(1);
    expect(h.db.tables.activity_streams[0]).toMatchObject({ source: 'apple', laps: null });
  });

  it('a later resend that carries the route fills it in, without touching the rest', async () => {
    const r = await registered();
    await upload(req('/api/device/activities', run({ route: [], name: 'בוקר' }), r.accessToken));
    h.db.tables.athlete_activities[0].activity_name = 'my own name';
    const res = await (await upload(req('/api/device/activities', run(), r.accessToken))).json();
    expect(res.status).toBe('duplicate');
    expect(res.enriched).toEqual(expect.arrayContaining(['gps_points', 'has_polyline']));
    expect(h.db.tables.athlete_activities[0]).toMatchObject({ has_polyline: true, activity_name: 'my own name' });
  });

  it('collapses a Strava copy of the same run into the Apple recording, keeping its id', async () => {
    const r = await registered();
    h.db.tables.athlete_activities.push({
      id: 'strava-row', athlete_id: 'ath-1', garmin_activity_id: -123, strava_activity_id: 123, source: 'strava',
      activity_name: 'Morning Run', start_time: '2026-10-08T06:31:00Z', distance: 10000, duration: 2990,
      calories: 700, gps_points: [], has_polyline: false, laps: null,
    });
    const res = await upload(req('/api/device/activities', run(), r.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'upgraded-strava', activityId: 'strava-row', twinSource: 'strava' });
    const rows = h.db.tables.athlete_activities;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'strava-row', source: 'apple', strava_activity_id: 123, garmin_activity_id: -123,
      activity_name: 'Morning Run', calories: 700, lap_count: 2, apple_workout_uuid: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    });
    // And a resend now finds it by uuid.
    expect((await (await upload(req('/api/device/activities', run(), r.accessToken))).json()).status).toBe('duplicate');
  });

  it('a Garmin copy wins: nothing is inserted, the twin is named', async () => {
    const r = await registered();
    h.db.tables.athlete_activities.push({
      id: 'garmin-row', athlete_id: 'ath-1', garmin_activity_id: 99, source: 'garmin',
      activity_name: 'Run', start_time: '2026-10-08T06:30:30Z', distance: 10050, duration: 2975,
    });
    const res = await (await upload(req('/api/device/activities', run(), r.accessToken))).json();
    expect(res).toMatchObject({ status: 'skipped-twin', activityId: 'garmin-row', twinSource: 'garmin' });
    expect(h.db.tables.athlete_activities).toHaveLength(1);
  });

  it('six reps nine minutes apart are six runs, not one (the overlap rule holds)', async () => {
    const r = await registered();
    for (let i = 0; i < 3; i++) {
      const start = new Date(Date.UTC(2026, 9, 8, 3, 30 + i * 9)).toISOString();
      const end = new Date(Date.UTC(2026, 9, 8, 3, 30 + i * 9, 430)).toISOString();
      const res = await (await upload(req('/api/device/activities', run({
        appleWorkoutUuid: `3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5${i}`, startDate: start, endDate: end, distanceM: 2000, durationS: 430, route: [],
      }), r.accessToken))).json();
      expect(res.status).toBe('inserted');
    }
    expect(h.db.tables.athlete_activities).toHaveLength(3);
  });

  it('rejects malformed uploads with 422', async () => {
    const r = await registered();
    for (const bad of [
      run({ appleWorkoutUuid: 'nope' }),
      run({ endDate: '2026-10-08T03:00:00Z' }),
      run({ distanceM: -1 }),
      run({ durationS: 0 }),
      run({ workoutPlanId: 'x' }),
      run({ schema: 'other' }),
    ]) {
      expect((await upload(req('/api/device/activities', bad, r.accessToken))).status).toBe(422);
    }
  });

  it('another athlete\'s device cannot write onto this athlete', async () => {
    const mine = await registered();
    h.session = { ok: true, user: { athleteId: 'ath-2' } };
    const theirs = await registered('other-phone');
    await upload(req('/api/device/activities', run(), theirs.accessToken));
    expect(h.db.tables.athlete_activities[0].athlete_id).toBe('ath-2');
    void mine;
  });
});
