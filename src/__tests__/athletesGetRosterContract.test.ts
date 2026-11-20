// B07: GET /api/athletes roster response schema, for a native roster. FIXTURE only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

const FULL = ['id', 'coach_id', 'name', 'email', 'status', 'created_at', 'garmin_auth', 'strava_auth', 'data_source', 'strava_enabled', 'onboarding_status', 'is_academy', 'group_id'];
let db = createMemoryDb({ schema: { athletes: FULL, groups: ['id', 'name'] } });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-session')>()), requireSession: async () => session }));

const seed = (cols = FULL) => {
  db = createMemoryDb({ schema: { athletes: cols, groups: ['id', 'name'] } });
  db.tables.groups.push({ id: 'g1', name: 'קבוצה 1' });
  const rows = [
    { id: 'a', coach_id: COACH_ID, name: 'A', email: 'a@example.test', status: 'active', created_at: '2026-01-02', garmin_auth: 'enc', strava_auth: null, data_source: 'garmin', strava_enabled: false, onboarding_status: null, is_academy: false, group_id: 'g1' },
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
  it('FINDING: lastSynced is "now" for anyone connected, not a real sync time', async () => {
    const before = Date.now();
    const r = await get();
    for (const a of r.body.athletes) expect(Date.parse(a.lastSynced)).toBeGreaterThanOrEqual(before - 1000);
  });
  it('FINDING: on the fallback query (a column missing) dataSource defaults to garmin and Strava/academy read false', async () => {
    seed(['id', 'coach_id', 'name', 'email', 'status', 'created_at', 'garmin_auth', 'strava_auth', 'group_id']);
    const r = await get();
    const b = r.body.athletes.find((a: any) => a.id === 'b');
    expect(b).toMatchObject({ dataSource: 'garmin', hasStrava: false, isAcademy: false, stravaEnabled: false });
  });
});
