// B07: GET /api/athletes roster response schema, for a native roster. FIXTURE only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

const BASE = ['id', 'coach_id', 'name', 'email', 'status', 'created_at', 'garmin_auth', 'strava_auth', 'data_source', 'strava_enabled', 'onboarding_status', 'is_academy', 'group_id'];
const FULL = [...BASE, 'garmin_last_sync_at', 'strava_last_sync_at'];
let db = createMemoryDb({ schema: { athletes: FULL, groups: ['id', 'name'] } });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-session')>()), requireSession: async () => session }));

const seed = (cols = FULL) => {
  db = createMemoryDb({ schema: { athletes: cols, groups: ['id', 'name'] } });
  db.tables.groups.push({ id: 'g1', name: 'קבוצה 1' });
  const rows = [
    { id: 'a', coach_id: COACH_ID, name: 'A', email: 'a@example.test', status: 'active', created_at: '2026-01-02', garmin_auth: 'enc', strava_auth: null, data_source: 'garmin', strava_enabled: false, onboarding_status: null, is_academy: false, group_id: 'g1', garmin_last_sync_at: '2026-11-19T05:00:00.000Z', strava_last_sync_at: '2026-11-20T05:00:00.000Z' },
    { id: 'b', coach_id: COACH_ID, name: 'B', email: 'b@example.test', status: 'invited', created_at: '2026-01-03', garmin_auth: null, strava_auth: 'enc-s', data_source: 'strava', strava_enabled: true, onboarding_status: 'x', is_academy: true, group_id: null },
    { id: 'z', coach_id: 'other-coach', name: 'Z', email: 'z@example.test', status: 'active', created_at: '2026-01-04', garmin_auth: null, strava_auth: null, data_source: null, strava_enabled: false, onboarding_status: null, is_academy: false, group_id: null },
  ];
  for (const r of rows) db.tables.athletes.push(Object.fromEntries(Object.entries(r).filter(([k]) => cols.includes(k))));
};
const get = async (qs = '') => {
  const { GET } = await import('@/app/api/athletes/route');
  const res = await GET(new Request(`http://x/api/athletes${qs}`));
  return { status: res.status, body: await res.json() };
};
const staff = { ok: true, user: { isStaff: true, athleteId: 'coach' } };
const member = { ok: true, user: { isStaff: false, athleteId: 'a' } };

beforeEach(() => { seed(); session = staff; });

describe('GET /api/athletes roster contract', () => {
  it('401 without a session', async () => {
    session = { ok: false, status: 401, error: 'unauthorized' };
    expect((await get()).status).toBe(401);
  });
  it('the shape, newest first, scoped to the club coach; credentials only as booleans', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.athletes.map((a: any) => a.id)).toEqual(['b', 'a']);
    expect(Object.keys(r.body.athletes[0]).sort()).toEqual(['createdAt', 'dataSource', 'email', 'groupId', 'groupName', 'group_id', 'hasGarmin', 'hasStrava', 'id', 'isAcademy', 'lastSynced', 'name', 'onboardingStatus', 'status', 'stravaEnabled'].sort());
    expect(JSON.stringify(r.body)).not.toContain('enc');
    expect(r.body.athletes[1]).toMatchObject({ groupId: 'g1', hasGarmin: true, hasStrava: false });
    expect(r.body.athletes[0]).toMatchObject({ groupId: null, groupName: null, isAcademy: true });
  });
  it('email is staff-only: a member gets null for everybody', async () => {
    session = member;
    const r = await get();
    expect(r.body.athletes.every((a: any) => a.email === null)).toBe(true);
  });
  it('FINDING: coach_id is caller-supplied, so any member can read another coach\'s roster', async () => {
    session = member;
    const r = await get('?coach_id=other-coach');
    expect(r.body.athletes.map((a: any) => a.id)).toEqual(['z']);
  });
  it('FIXED (B24): lastSynced is the latest REAL stamp of a CONNECTED provider, else null', async () => {
    const r = await get();
    const a = r.body.athletes.find((x: any) => x.id === 'a');
    const b = r.body.athletes.find((x: any) => x.id === 'b');
    // a: Garmin connected (stamp 19th); its Strava stamp is ignored because Strava is not connected.
    expect(a.lastSynced).toBe('2026-11-19T05:00:00.000Z');
    // b: Strava connected but no stamp recorded -> unknown, not "now".
    expect(b.lastSynced).toBeNull();
  });
  it('B24: a database without the sync-stamp columns keeps the full roster (middle fallback), lastSynced null', async () => {
    seed(BASE);
    const r = await get();
    const b = r.body.athletes.find((x: any) => x.id === 'b');
    expect(b).toMatchObject({ dataSource: 'strava', hasStrava: true, isAcademy: true, lastSynced: null });
  });
  it('FIXED (B25): on the core fallback the provider is reported as unknown (null), not "garmin"/false', async () => {
    seed(['id', 'coach_id', 'name', 'email', 'status', 'created_at', 'garmin_auth', 'strava_auth', 'group_id']);
    const r = await get();
    const a = r.body.athletes.find((x: any) => x.id === 'a');
    const b = r.body.athletes.find((x: any) => x.id === 'b');
    expect(a).toMatchObject({ dataSource: 'garmin', hasGarmin: true, hasStrava: null, stravaEnabled: null });
    expect(b).toMatchObject({ dataSource: null, hasGarmin: false, hasStrava: null, stravaEnabled: null });
  });
});
