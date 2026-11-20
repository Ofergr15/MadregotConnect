import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native iOS companion app: the /api/device/* routes (plan H5–H7,
 * docs/contracts/watch-device.md, docs/apple-watch.md).
 *
 * The REAL route handlers and the REAL lib/watch code (token signing, rotation,
 * reuse revocation, pending window, ingest + twin rules) run against a small
 * in-memory fake of the Supabase client. Only the athlete session
 * (`requireAthlete`) and the DB are faked; the post-upload side effects (badges,
 * plan matcher, stream store, push) are stubbed because they are not part of the
 * contract. If one of these breaks, the native decoder or its retry logic breaks
 * with it — change the app in the same change.
 */

process.env.ENCRYPTION_KEY = 'k'.repeat(40);

// ── fake Supabase: tiny in-memory tables + the chain the routes use ─────────────
type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let missing = new Set<string>();
let seq = 0;
const log: Array<{ table: string; kind: string; ops: unknown[][] }> = [];

function match(row: Row, ops: unknown[][]): boolean {
  for (const [m, col, v, w] of ops as [string, string, any, any][]) {
    if (m === 'eq' && row[col] !== v) return false;
    if (m === 'is' && v === null && row[col] != null) return false;
    if (m === 'not' && v === 'is' && w === null && row[col] == null) return false;
    if (m === 'in' && !(v as unknown[]).includes(row[col])) return false;
    if (m === 'gte' && !(row[col] >= v)) return false;
    if (m === 'lte' && !(row[col] <= v)) return false;
  }
  return true;
}

function builder(table: string) {
  const q = { table, kind: 'select', ops: [] as unknown[][], patch: null as Row | null, insert: null as Row | null, cols: '' };
  log.push(q);
  const run = () => {
    if (missing.has(table)) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    const rows = (tables[table] ||= []);
    if (q.kind === 'insert') {
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, created_at: new Date(Date.now() + seq).toISOString(), revoked_at: null, used_at: null, replaced_by: null, ...q.insert };
      rows.push(row);
      return { data: [row], error: null };
    }
    let hit = rows.filter((r) => match(r, q.ops));
    if (q.kind === 'update') {
      for (const r of hit) Object.assign(r, q.patch);
      return { data: hit, error: null };
    }
    const order = q.ops.find(([m]) => m === 'order') as [string, string, { ascending?: boolean }] | undefined;
    if (order) hit = [...hit].sort((a, b) => (a[order[1]] < b[order[1]] ? -1 : 1) * (order[2]?.ascending === false ? -1 : 1));
    if (q.cols.includes('athletes!inner')) {
      hit = hit.map((r) => ({ ...r, athletes: { status: (tables.athletes || []).find((a) => a.id === r.athlete_id)?.status ?? null } }));
    }
    return { data: hit, error: null };
  };
  const b: any = {};
  for (const m of ['eq', 'in', 'is', 'not', 'or', 'gte', 'lte', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => { q.ops.push([m, ...args]); return b; };
  }
  b.select = (cols = '') => { if (q.kind === 'select') q.cols = cols; return b; };
  b.update = (patch: Row) => { q.kind = 'update'; q.patch = patch; return b; };
  b.insert = (row: Row) => { q.kind = 'insert'; q.insert = row; return b; };
  b.maybeSingle = async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; };
  b.single = async () => { const r = run(); const one = (r.data as Row[] | null)?.[0]; return one ? { data: one, error: null } : { data: null, error: r.error || { message: 'no row' } }; };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

// ── fake session (the athlete signed in inside the app) ─────────────────────────
let session: { athleteId: string; viewingAsBy?: string } | null = null;
const requireAthlete = vi.fn(async () => (session
  ? { ok: true, user: { ...session } }
  : { ok: false, status: 401, error: 'Authentication required' }));
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<object>()), requireAthlete: (...a: unknown[]) => requireAthlete(...(a as [])) }));

// ── side effects outside the contract ───────────────────────────────────────────
const notifyAthlete = vi.fn(async () => undefined);
vi.mock('@/lib/push', () => ({ notifyAthlete: (...a: unknown[]) => notifyAthlete(...(a as [])) }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({ matchAthleteActivities: async () => undefined }));
vi.mock('@/lib/garmin/stream-store', () => ({ saveActivityStream: async () => undefined }));
vi.mock('@/lib/badges/award-engine', () => ({ checkAndAwardBadges: async () => undefined }));
vi.mock('@/lib/challenges/engine', () => ({ checkAndAwardChallenges: async () => undefined }));
vi.mock('@/lib/shoes', () => ({ checkShoeAlert: async () => undefined }));
vi.mock('@/lib/prs/new-record-alert', () => ({ notifyNewRecords: async () => undefined }));

const register = await import('@/app/api/device/register/route');
const token = await import('@/app/api/device/token/route');
const pending = await import('@/app/api/device/pending-workouts/route');
const ack = await import('@/app/api/device/deliveries/ack/route');
const activities = await import('@/app/api/device/activities/route');
const revoke = await import('@/app/api/device/revoke/route');
const { resetWatchSchemaCache } = await import('@/lib/watch/schema');
const { hashToken } = await import('@/lib/watch/device-auth');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-19T08:00:00Z'); // Thursday, Israel 10:00

const post = (body?: unknown, auth?: string) =>
  new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (auth?: string) => new Request('http://x', { headers: auth ? { authorization: `Bearer ${auth}` } : {} });

async function registered(installationId = 'inst-1') {
  session = { athleteId: ME };
  const res = await register.POST(post({ platform: 'ios', installationId, schedulerAuthorized: true }, 'supabase-jwt'));
  session = null;
  return res.json() as Promise<{ deviceId: string; refreshToken: string; accessToken: string; accessTokenExpiresAt: string }>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetWatchSchemaCache();
  tables = {
    athletes: [{ id: ME, status: 'active', active_shoe_id: null }, { id: OTHER, status: 'active', active_shoe_id: null }],
    athlete_devices: [],
    device_tokens: [],
    workout_deliveries: [],
    athlete_activities: [],
    activity_plan_matches: [],
  };
  missing = new Set();
  log.length = 0;
  session = null;
  requireAthlete.mockClear();
  notifyAthlete.mockClear();
});
afterEach(() => vi.useRealTimers());

// ─────────────────────────────────────────────────────────────────────────────
describe('migration 138 absent → 404 { error: "watch-not-enabled" }, checked BEFORE auth', () => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ['register', () => register.POST(post({ installationId: 'x' }))],
    ['token', () => token.POST(post({ refreshToken: 'wrt1.x' }))],
    ['pending-workouts', () => pending.GET(get())],
    ['deliveries/ack', () => ack.POST(post({ scheduled: [] }))],
    ['activities', () => activities.POST(post({}))],
    ['revoke', () => revoke.POST(post({}))],
  ];
  for (const [name, call] of routes) {
    it(`${name}: no credentials at all still gets the 404, not a 401/400`, async () => {
      missing = new Set(['athlete_devices', 'device_tokens']);
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'watch-not-enabled' });
      expect(requireAthlete).not.toHaveBeenCalled();
      // Nothing but the two schema probes was read.
      expect(new Set(log.map((q) => q.table))).toEqual(new Set(['athlete_devices', 'workout_deliveries']));
    });
  }
  it('a half-applied 138 (tables, but no workout_deliveries.provider_plan_id) also reads as absent', async () => {
    missing = new Set(['workout_deliveries']);
    expect((await pending.GET(get('wat1.anything'))).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/device/register', () => {
  it('→ 201 { deviceId, refreshToken: "wrt1.…", accessToken: "wat1.…", accessTokenExpiresAt } — refresh stored only as a hash', async () => {
    session = { athleteId: ME };
    const res = await register.POST(post({ platform: 'ios', installationId: 'inst-1', appVersion: '1.0', apnsToken: 'AB'.repeat(32), schedulerAuthorized: true }, 'jwt'));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'accessTokenExpiresAt', 'deviceId', 'refreshToken']);
    expect(body.refreshToken).toMatch(/^wrt1\./);
    expect(body.accessToken).toMatch(/^wat1\./);
    expect(body.accessTokenExpiresAt).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
    const [dev] = tables.athlete_devices;
    expect(dev).toMatchObject({ id: body.deviceId, athlete_id: ME, platform: 'ios', installation_id: 'inst-1', app_version: '1.0', apns_token: 'ab'.repeat(32), scheduler_authorized: true });
    expect(tables.device_tokens[0].token_hash).toBe(hashToken(body.refreshToken));
    expect(JSON.stringify(tables.device_tokens)).not.toContain(body.refreshToken);
  });
  it('no session → 401 (requireAthlete answer, passed through); view-as → 403', async () => {
    const res = await register.POST(post({ installationId: 'i' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    session = { athleteId: ME, viewingAsBy: 'admin' };
    const res2 = await register.POST(post({ installationId: 'i' }, 'jwt'));
    expect(res2.status).toBe(403);
    expect(await res2.json()).toEqual({ error: 'view-as cannot register a device' });
  });
  it('validation: no body → 400; no installationId → 400; platform other than "ios" → 400 unsupported-platform', async () => {
    session = { athleteId: ME };
    expect(await (await register.POST(post(undefined, 'jwt'))).json()).toEqual({ error: 'JSON body required' });
    const noInst = await register.POST(post({ platform: 'ios' }, 'jwt'));
    expect(noInst.status).toBe(400);
    expect(await noInst.json()).toEqual({ error: 'installationId required' });
    expect(await (await register.POST(post({ platform: 'android', installationId: 'i' }, 'jwt'))).json()).toEqual({ error: 'unsupported-platform' });
  });
  it('the same installationId again replaces the old registration (old device + its tokens revoked)', async () => {
    const first = await registered('inst-1');
    const second = await registered('inst-1');
    expect(second.deviceId).not.toBe(first.deviceId);
    const old = tables.athlete_devices.find((d) => d.id === first.deviceId)!;
    expect(old.revoked_at).not.toBeNull();
    expect(tables.device_tokens.filter((t) => t.device_id === first.deviceId).every((t) => t.revoked_at)).toBe(true);
    // The old access token now answers 401 "Device revoked".
    const res = await pending.GET(get(first.accessToken));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Device revoked' });
  });
  it('at most 5 live devices: a 6th registration retires the oldest', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await registered(`inst-${i}`)).deviceId);
    const live = tables.athlete_devices.filter((d) => !d.revoked_at).map((d) => d.id);
    expect(live).toHaveLength(5);
    expect(live).not.toContain(ids[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/device/token — rotation', () => {
  it('→ 200 { accessToken, accessTokenExpiresAt, refreshToken: NEW } and the presented token is spent', async () => {
    const reg = await registered();
    const res = await token.POST(post({ refreshToken: reg.refreshToken, appVersion: '1.1', healthAuthorized: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'accessTokenExpiresAt', 'refreshToken']);
    expect(body.refreshToken).toMatch(/^wrt1\./);
    expect(body.refreshToken).not.toBe(reg.refreshToken);
    const spent = tables.device_tokens.find((t) => t.token_hash === hashToken(reg.refreshToken))!;
    expect(spent.used_at).toBe(NOW.toISOString());
    // The device-state fields ride along on the refresh.
    expect(tables.athlete_devices[0]).toMatchObject({ app_version: '1.1', health_authorized: true });
    // and the new access token works
    expect((await pending.GET(get(body.accessToken))).status).toBe(200);
  });
  it('lost answer: the OLD token again within 120 s → 200 with yet another token; the unused successor is revoked', async () => {
    const reg = await registered();
    const a = await (await token.POST(post({ refreshToken: reg.refreshToken }))).json();
    vi.setSystemTime(NOW.getTime() + 60_000);
    const retry = await token.POST(post({ refreshToken: reg.refreshToken }));
    expect(retry.status).toBe(200);
    const b = await retry.json();
    expect(b.refreshToken).not.toBe(a.refreshToken);
    expect(tables.device_tokens.find((t) => t.token_hash === hashToken(a.refreshToken))!.revoked_at).not.toBeNull();
    expect((await token.POST(post({ refreshToken: a.refreshToken }))).status).toBe(401); // refresh-revoked
    expect((await token.POST(post({ refreshToken: b.refreshToken }))).status).toBe(200);
  });
  it('REUSE after the grace window → 401 "refresh-reused" and the whole device is revoked', async () => {
    const reg = await registered();
    const a = await (await token.POST(post({ refreshToken: reg.refreshToken }))).json();
    vi.setSystemTime(NOW.getTime() + 121_000);
    const res = await token.POST(post({ refreshToken: reg.refreshToken }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'refresh-reused' });
    expect(tables.athlete_devices[0].revoked_at).not.toBeNull();
    expect(tables.device_tokens.every((t) => t.revoked_at)).toBe(true);
    // The legitimate phone is locked out too — it must sign in again.
    expect(await (await token.POST(post({ refreshToken: a.refreshToken }))).json()).toEqual({ error: 'refresh-revoked' });
    expect(await (await pending.GET(get(a.accessToken))).json()).toEqual({ error: 'Device revoked' });
  });
  it('REUSE inside the grace window once the successor was already used → also refresh-reused', async () => {
    const reg = await registered();
    const a = await (await token.POST(post({ refreshToken: reg.refreshToken }))).json();
    await token.POST(post({ refreshToken: a.refreshToken }));
    vi.setSystemTime(NOW.getTime() + 30_000);
    expect(await (await token.POST(post({ refreshToken: reg.refreshToken }))).json()).toEqual({ error: 'refresh-reused' });
  });
  it('error vocabulary: 400 refreshToken required · 401 refresh-unknown / refresh-expired / refresh-revoked · 403 inactive', async () => {
    expect(await (await token.POST(post({}))).json()).toEqual({ error: 'refreshToken required' });
    expect((await token.POST(post({}))).status).toBe(400);
    const unknown = await token.POST(post({ refreshToken: 'wrt1.nope' }));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: 'refresh-unknown' });
    expect(await (await token.POST(post({ refreshToken: 'not-a-refresh-token' }))).json()).toEqual({ error: 'refresh-unknown' });

    const reg = await registered();
    vi.setSystemTime(NOW.getTime() + 181 * 24 * 3600_000);
    expect(await (await token.POST(post({ refreshToken: reg.refreshToken }))).json()).toEqual({ error: 'refresh-expired' });
    vi.setSystemTime(NOW);

    const reg2 = await registered('inst-2');
    tables.athletes[0].status = 'inactive';
    const inactive = await token.POST(post({ refreshToken: reg2.refreshToken }));
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toEqual({ error: 'Account is not active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('device bearer (wat1.…) on the device routes', () => {
  it('missing / garbage / expired access token → 401 "Invalid or expired device token"', async () => {
    const reg = await registered();
    for (const auth of [undefined, 'garbage', reg.accessToken.slice(0, -2) + 'xx']) {
      const res = await pending.GET(get(auth));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid or expired device token' });
    }
    vi.setSystemTime(NOW.getTime() + 15 * 60_000);
    expect((await pending.GET(get(reg.accessToken))).status).toBe(401);
  });
  it('athlete deactivated → 403 "Account is not active" immediately (checked per request)', async () => {
    const reg = await registered();
    tables.athletes[0].status = 'inactive';
    const res = await ack.POST(post({ scheduled: [] }, reg.accessToken));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Account is not active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const WORKOUT = (partKind?: string) => ({ schema: 'madregot.watch-workout', version: 1, ...(partKind ? { partKind } : {}) });
const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const delivery = (n: number, o: Row = {}): Row => ({
  id: uuid(n), athlete_id: ME, provider: 'apple', provider_plan_id: uuid(1000 + n), workout_date: '2026-11-20',
  workout_key: null, workout_data: WORKOUT(), status: 'pending', superseded_at: null, removed_at: null, ...o,
});

describe('GET /api/device/pending-workouts', () => {
  it('→ { serverTime, window, maxScheduled: 15, workouts[], remove[] } — exact entry shapes', async () => {
    const reg = await registered();
    tables.workout_deliveries = [
      delivery(1, { workout_date: '2026-11-21', workout_key: 'fri-part-2' }),
      delivery(2, { workout_date: '2026-11-21', workout_key: 'fri-part-1', status: 'success' }),
      delivery(3, { workout_date: '2026-11-22', workout_data: WORKOUT('evening') }),
      delivery(4, { workout_date: '2026-11-20', superseded_at: '2026-11-19T07:00:00Z' }), // coach changed it
    ];
    const res = await pending.GET(get(reg.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      serverTime: NOW.toISOString(),
      window: { from: '2026-11-18', to: '2026-11-26' }, // yesterday … today+7, Israel dates
      maxScheduled: 15,
      workouts: [
        { deliveryId: uuid(2), planId: uuid(1002), date: '2026-11-21', scheduledAt: { date: '2026-11-21', hour: 6, minute: 0 }, status: 'success', workout: WORKOUT() },
        { deliveryId: uuid(1), planId: uuid(1001), date: '2026-11-21', scheduledAt: { date: '2026-11-21', hour: 6, minute: 1 }, status: 'pending', workout: WORKOUT() },
        { deliveryId: uuid(3), planId: uuid(1003), date: '2026-11-22', scheduledAt: { date: '2026-11-22', hour: 18, minute: 0 }, status: 'pending', workout: WORKOUT('evening') },
      ],
      remove: [{ deliveryId: uuid(4), planId: uuid(1004), date: '2026-11-20' }],
    });
  });
  it('nothing queued → workouts: [] and remove: [] (never null)', async () => {
    const reg = await registered();
    const body = await (await pending.GET(get(reg.accessToken))).json();
    expect(body.workouts).toEqual([]);
    expect(body.remove).toEqual([]);
  });
  it('excluded: other athletes, Garmin rows, failed rows, outside the window, bad plan id / schema, already-removed', async () => {
    const reg = await registered();
    tables.workout_deliveries = [
      delivery(1, { athlete_id: OTHER }),
      delivery(2, { provider: 'garmin' }),
      delivery(3, { status: 'failed' }),
      delivery(4, { workout_date: '2026-11-17' }),
      delivery(5, { workout_date: '2026-11-27' }),
      delivery(6, { provider_plan_id: 'not-a-uuid' }),
      delivery(7, { workout_data: { schema: 'something-else' } }),
      delivery(8, { superseded_at: '2026-11-19T07:00:00Z', removed_at: '2026-11-19T07:30:00Z' }),
      delivery(9),
    ];
    const body = await (await pending.GET(get(reg.accessToken))).json();
    expect(body.workouts.map((w: Row) => w.deliveryId)).toEqual([uuid(9)]);
    expect(body.remove).toEqual([]);
  });
  it('capped at the nearest 15, earliest first', async () => {
    const reg = await registered();
    tables.workout_deliveries = Array.from({ length: 20 }, (_, i) =>
      delivery(i + 1, { workout_date: `2026-11-${String(18 + (i % 9)).padStart(2, '0')}`, workout_key: `part-${Math.floor(i / 9) + 1}` }));
    const body = await (await pending.GET(get(reg.accessToken))).json();
    expect(body.workouts).toHaveLength(15);
    const dates = body.workouts.map((w: Row) => w.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-11-18');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/device/deliveries/ack', () => {
  it('→ { scheduled, removed, failed } counts; only the caller\'s own Apple rows move', async () => {
    const reg = await registered();
    tables.workout_deliveries = [
      delivery(1),
      delivery(2, { athlete_id: OTHER }),
      delivery(3, { superseded_at: '2026-11-19T07:00:00Z' }),
      delivery(4),
      delivery(5, { provider: 'garmin' }),
    ];
    const res = await ack.POST(post({
      scheduled: [uuid(1), uuid(2), uuid(5), 'not-a-uuid'],
      removed: [uuid(3)],
      failed: [{ deliveryId: uuid(4), error: 'alert refused' }],
    }, reg.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scheduled: 1, removed: 1, failed: 1 });
    const byId = Object.fromEntries(tables.workout_deliveries.map((d) => [d.id, d]));
    expect(byId[uuid(1)].status).toBe('success');
    expect(byId[uuid(2)].status).toBe('pending');
    expect(byId[uuid(3)].removed_at).toBe(NOW.toISOString());
    expect(byId[uuid(4)]).toMatchObject({ status: 'failed', error_message: 'apple: alert refused' });
    expect(byId[uuid(5)].status).toBe('pending');
    // "on your watch" push, once, for the newly scheduled day(s)
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0]).toEqual([expect.objectContaining({ athleteId: ME, kind: 'plan_pushed', category: 'program' })]);
  });
  it('a body with nothing recognisable is fine → { 0, 0, 0 }; no body → 400', async () => {
    const reg = await registered();
    expect(await (await ack.POST(post({}, reg.accessToken))).json()).toEqual({ scheduled: 0, removed: 0, failed: 0 });
    const res = await ack.POST(post(undefined, reg.accessToken));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'JSON body required' });
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const WORKOUT_UUID = 'bbbbbbbb-1111-4111-8111-111111111111';
const upload = (o: Row = {}) => ({
  schema: 'madregot.apple-activity', version: 1, appleWorkoutUuid: WORKOUT_UUID.toUpperCase(), workoutPlanId: null,
  startDate: '2026-11-19T04:30:00Z', endDate: '2026-11-19T05:20:00Z', timeZone: 'Asia/Jerusalem', indoor: false,
  name: 'Morning Run', distanceM: 10_000, durationS: 3000, energyKcal: 650, avgHr: 150, maxHr: 170,
  elevationGainM: 20, avgCadence: 176, laps: [], route: [], heartRate: [], ...o,
});
// 04:30Z in Asia/Jerusalem (UTC+2 in November) → wall clock 06:30, stored "as if UTC".
const LOCAL_START = '2026-11-19T06:30:00Z';

describe('POST /api/device/activities', () => {
  it('new run → 201 { status: "inserted", activityId, match: null }; start_time is the wall clock (Convention A)', async () => {
    const reg = await registered();
    const res = await activities.POST(post(upload(), reg.accessToken));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ status: 'inserted', activityId: expect.any(String), match: null });
    const [row] = tables.athlete_activities;
    expect(row).toMatchObject({ id: body.activityId, athlete_id: ME, source: 'apple', apple_workout_uuid: WORKOUT_UUID, start_time: LOCAL_START, distance: 10_000, duration: 3000, average_pace: 300 });
    expect(row.garmin_activity_id).toBeLessThan(-(2 ** 52));
  });
  it('the same appleWorkoutUuid again → 200 { status: "duplicate", activityId: same, enriched: [] }; a later route/laps fills gaps only', async () => {
    const reg = await registered();
    const first = await (await activities.POST(post(upload(), reg.accessToken))).json();
    const again = await activities.POST(post(upload(), reg.accessToken));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'duplicate', activityId: first.activityId, enriched: [], match: null });
    const withLaps = await (await activities.POST(post(upload({ laps: [{ startOffsetS: 0, durationS: 300, distanceM: 1000 }] }), reg.accessToken))).json();
    expect(withLaps).toMatchObject({ status: 'duplicate', activityId: first.activityId, enriched: ['laps', 'lap_count'] });
    expect(tables.athlete_activities).toHaveLength(1);
  });
  it('a STRAVA copy of the run → 200 { status: "upgraded-strava", twinSource: "strava" } — same row id, name + strava id kept', async () => {
    const reg = await registered();
    tables.athlete_activities = [{ id: 'strava-row', athlete_id: ME, source: 'strava', start_time: LOCAL_START, distance: 10_010, duration: 3005, activity_name: 'שם שלי', strava_activity_id: 987, calories: null }];
    const res = await activities.POST(post(upload(), reg.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'upgraded-strava', activityId: 'strava-row', twinSource: 'strava', match: null });
    expect(tables.athlete_activities).toHaveLength(1);
    expect(tables.athlete_activities[0]).toMatchObject({ id: 'strava-row', source: 'apple', apple_workout_uuid: WORKOUT_UUID, activity_name: 'שם שלי', strava_activity_id: 987, calories: 650 });
  });
  it('a GARMIN copy of the run wins → 200 { status: "skipped-twin", activityId: <garmin row>, twinSource: "garmin" }, nothing written', async () => {
    const reg = await registered();
    tables.athlete_activities = [{ id: 'garmin-row', athlete_id: ME, source: 'garmin', start_time: LOCAL_START, distance: 10_000, duration: 3000 }];
    const res = await activities.POST(post(upload(), reg.accessToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'skipped-twin', activityId: 'garmin-row', twinSource: 'garmin', match: null });
    expect(tables.athlete_activities).toHaveLength(1);
    expect(tables.athlete_activities[0].source).toBe('garmin');
  });
  it('validation → 422 { error } (bad uuid, end before start, future, bad distance); no body → 400', async () => {
    const reg = await registered();
    const cases: Array<[Row, string]> = [
      [{ appleWorkoutUuid: 'nope' }, 'appleWorkoutUuid must be a UUID'],
      [{ workoutPlanId: 'nope' }, 'workoutPlanId must be a UUID'],
      [{ endDate: '2026-11-19T04:00:00Z' }, 'startDate/endDate invalid'],
      [{ startDate: '2026-11-20T04:30:00Z', endDate: '2026-11-20T05:00:00Z' }, 'workout in the future'],
      [{ distanceM: -1 }, 'distanceM invalid'],
      [{ schema: 'other' }, 'unknown schema'],
    ];
    for (const [o, error] of cases) {
      const res = await activities.POST(post(upload(o), reg.accessToken));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error });
    }
    const empty = await activities.POST(post(undefined, reg.accessToken));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'JSON body required (max 4 MB)' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/device/revoke', () => {
  it('with the device\'s own access token → { revoked: true }; that device is dead afterwards', async () => {
    const reg = await registered();
    const res = await revoke.POST(post(undefined, reg.accessToken));
    expect(await res.json()).toEqual({ revoked: true });
    expect((await pending.GET(get(reg.accessToken))).status).toBe(401);
    expect(await (await token.POST(post({ refreshToken: reg.refreshToken }))).json()).toEqual({ error: 'refresh-revoked' });
  });
  it('with { refreshToken } and no auth → { revoked: true } — the same answer for an unknown token (no oracle)', async () => {
    const reg = await registered();
    expect(await (await revoke.POST(post({ refreshToken: 'wrt1.unknown' }))).json()).toEqual({ revoked: true });
    expect(tables.athlete_devices[0].revoked_at).toBeNull();
    expect(await (await revoke.POST(post({ refreshToken: reg.refreshToken }))).json()).toEqual({ revoked: true });
    expect(tables.athlete_devices[0].revoked_at).not.toBeNull();
  });
  it('neither → 400; athlete session + { deviceId } revokes only one of THEIR devices (else 404)', async () => {
    expect((await revoke.POST(post({}))).status).toBe(400);
    const reg = await registered();
    session = { athleteId: OTHER };
    const notMine = await revoke.POST(post({ deviceId: reg.deviceId }, 'supabase-jwt'));
    expect(notMine.status).toBe(404);
    expect(await notMine.json()).toEqual({ error: 'Device not found' });
    session = { athleteId: ME };
    expect(await (await revoke.POST(post({ deviceId: reg.deviceId }, 'supabase-jwt'))).json()).toEqual({ revoked: true });
  });
});
