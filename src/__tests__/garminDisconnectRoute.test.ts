// POST /api/garmin/disconnect — FIXTURE only; no Garmin call is made by the route at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createMemoryDb } from './helpers/memory-db';

const FULL = ['id', 'data_source', 'garmin_auth', 'strava_auth', 'garmin_authed_at', 'garmin_last_sync_at', 'garmin_auth_failed_at'];
let db = createMemoryDb({ schema: { athletes: FULL, athlete_activities: ['id', 'athlete_id'] } });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let gate: { denied: Response | null } = { denied: null };
const gateCalls: unknown[] = [];
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: async (_r: Request, id: unknown) => { gateCalls.push(id); return { ...gate, caller: {} }; },
}));

const seed = (cols = FULL) => {
  db = createMemoryDb({ schema: { athletes: cols, athlete_activities: ['id', 'athlete_id'] } });
  const full = { id: 'a1', data_source: 'garmin', garmin_auth: 'enc', strava_auth: null, garmin_authed_at: 't', garmin_last_sync_at: 't', garmin_auth_failed_at: null };
  db.tables.athletes.push(Object.fromEntries(Object.entries(full).filter(([k]) => cols.includes(k))));
  db.tables.athlete_activities.push({ id: 'r1', athlete_id: 'a1' });
};
const call = async (raw: string) => {
  const { POST } = await import('@/app/api/garmin/disconnect/route');
  const res = await POST(new Request('http://x/api/garmin/disconnect', { method: 'POST', body: raw }));
  return { status: res.status, body: await res.json() };
};
const a1 = () => db.tables.athletes[0];

beforeEach(() => { gate = { denied: null }; gateCalls.length = 0; seed(); });

describe('POST /api/garmin/disconnect', () => {
  it('400 for a malformed body or no athleteId, before the gate', async () => {
    expect((await call('{')).status).toBe(400);
    expect((await call('{}')).status).toBe(400);
    expect(gateCalls).toHaveLength(0);
  });
  it('the gate is asked about the target athlete, and its refusal is returned unchanged with nothing written', async () => {
    gate = { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
    expect((await call(JSON.stringify({ athleteId: 'a1' }))).status).toBe(403);
    expect(gateCalls).toEqual(['a1']);
    expect(a1().garmin_auth).toBe('enc');
  });
  it('404 for an unknown athlete', async () => {
    expect((await call(JSON.stringify({ athleteId: 'nope' }))).status).toBe(404);
  });
  it('clears the token and its stamps, keeps activities, leaves data_source when Strava is not connected', async () => {
    const r = await call(JSON.stringify({ athleteId: 'a1' }));
    expect(r).toEqual({ status: 200, body: { ok: true, wasConnected: true, dataSource: 'garmin' } });
    expect(a1()).toMatchObject({ garmin_auth: null, garmin_authed_at: null, garmin_last_sync_at: null, garmin_auth_failed_at: null, data_source: 'garmin' });
    expect(db.tables.athlete_activities).toHaveLength(1);
  });
  it('moves data_source to strava only when Strava is connected', async () => {
    a1().strava_auth = 'enc-s';
    const r = await call(JSON.stringify({ athleteId: 'a1' }));
    expect(r.body.dataSource).toBe('strava');
    expect(a1().data_source).toBe('strava');
  });
  it('is idempotent: a second call is 200 with wasConnected false', async () => {
    await call(JSON.stringify({ athleteId: 'a1' }));
    expect((await call(JSON.stringify({ athleteId: 'a1' }))).body).toMatchObject({ ok: true, wasConnected: false });
  });
  it('pre-migration database (no stamp columns): falls back to clearing the token alone', async () => {
    seed(['id', 'data_source', 'garmin_auth', 'strava_auth']);
    const r = await call(JSON.stringify({ athleteId: 'a1' }));
    expect(r.status).toBe(200);
    expect(a1().garmin_auth).toBeNull();
  });
  it('never returns the stored token', async () => {
    const r = await call(JSON.stringify({ athleteId: 'a1' }));
    expect(JSON.stringify(r.body)).not.toContain('enc');
  });
});
