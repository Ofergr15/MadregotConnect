import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * Account deletion: the member's request (GET/POST/DELETE /api/account/delete-request),
 * the admin action that carries it out (/api/admin/account-deletion), and what
 * migration 204's anonymise_athlete promises to remove.
 */

const ME = uid();
const ADMIN = uid();

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => ({ recipients: 1, sent: 1 }) }));
const deleteUser = vi.fn(async (_id: string, _o: unknown) => ({}));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({ deleteUser }) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client }));

const request = await import('@/app/api/account/delete-request/route');
const admin = await import('@/app/api/admin/account-deletion/route');
const { storagePathFromUrl } = await import('@/lib/account/storage-path');

const as = (athleteId: string | null, role = 'runner') =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId, role, roles: [role], isStaff: role !== 'runner', isSuperUser: false, email: 'x' } });
const req = (method: string, body?: unknown) =>
  new Request('http://x/api', { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

function memory(migrated = true) {
  const db = createMemoryDb({
    schema: {
      ...(migrated ? { account_deletion_requests: ['id', 'athlete_id', 'reason', 'status', 'created_at', 'handled_at', 'handled_by'] } : {}),
      athletes: ['id', 'name', 'email', 'avatar_url'],
      detected_faces: ['id', 'athlete_id', 'crop_url'],
    },
  });
  db.tables.athletes.push({ id: ME, name: 'Dana', email: 'dana@example.com', avatar_url: `https://s/storage/v1/object/public/avatars/${ME}.jpg?v=1` });
  return db;
}

describe('/api/account/delete-request (self only)', () => {
  let db: ReturnType<typeof memory>;
  beforeEach(() => { db = memory(); client = db.client; as(ME); });

  it('GET reports migrated and no request, then the pending one after POST', async () => {
    expect(await (await request.GET(req('GET'))).json()).toEqual({ request: null, migrated: true });
    const posted = await (await request.POST(req('POST', { reason: 'moving', athleteId: uid() }))).json();
    expect(posted.request).toMatchObject({ status: 'pending', slaDays: 7 });
    expect(db.tables.account_deletion_requests[0].athlete_id).toBe(ME);
    // Idempotent: a second POST returns the same pending request.
    await request.POST(req('POST'));
    expect(db.tables.account_deletion_requests.filter((r) => r.status === 'pending')).toHaveLength(1);
    expect((await (await request.GET(req('GET'))).json()).request).toMatchObject({ status: 'pending' });
  });

  it('DELETE cancels the pending request', async () => {
    await request.POST(req('POST'));
    expect(await (await request.DELETE(req('DELETE'))).json()).toEqual({ request: null });
    expect(db.tables.account_deletion_requests[0].status).toBe('cancelled');
    expect((await (await request.GET(req('GET'))).json()).request).toBeNull();
  });

  it('unmigrated: GET says migrated false, POST 503', async () => {
    client = memory(false).client;
    expect(await (await request.GET(req('GET'))).json()).toEqual({ request: null, migrated: false });
    expect((await request.POST(req('POST'))).status).toBe(503);
  });

  it('403 for a session with no athlete row', async () => {
    as(null, 'coach');
    expect((await request.POST(req('POST'))).status).toBe(403);
  });
});

describe('/api/admin/account-deletion', () => {
  let db: ReturnType<typeof memory>;
  const rpc = vi.fn(async (_n: string, _a: unknown) => ({ error: null as null | { code?: string; message: string } }));
  const removed: Record<string, string[]> = {};
  const authDelete = vi.fn(async (_id: string) => ({ error: null }));

  beforeEach(() => {
    db = memory();
    for (const k of Object.keys(removed)) delete removed[k];
    rpc.mockClear(); authDelete.mockClear(); deleteUser.mockClear();
    process.env.STREAM_API_KEY = 'k'; process.env.STREAM_API_SECRET = 's';
    db.tables.detected_faces.push({ id: uid(), athlete_id: ME, crop_url: 'https://s/storage/v1/object/public/face-crops/p1/c1.jpg' });
    client = {
      from: (t: string) => db.client.from(t),
      rpc,
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string) => ({ data: bucket === 'avatars' ? [{ name: `${ME}.jpg` }] : folder === ME ? [{ name: 'a.jpg' }] : [] }),
          remove: async (paths: string[]) => { removed[bucket] = paths; return { error: null }; },
        }),
      },
      auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'auth-1', email: 'Dana@example.com' }] }, error: null }), deleteUser: authDelete } },
    };
    as(ADMIN, 'admin');
  });

  it('is admin only — a coach and the member themselves get 403', async () => {
    as(ADMIN, 'coach');
    expect((await admin.POST(req('POST', { athleteId: ME }))).status).toBe(403);
    as(ME);
    expect((await admin.POST(req('POST', { athleteId: ME }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a member who never asked (409) and a bad id (400)', async () => {
    expect((await admin.POST(req('POST', { athleteId: ME }))).status).toBe(409);
    expect((await admin.POST(req('POST', { athleteId: 'x' }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('runs anonymise_athlete, then storage, Stream chat and the login', async () => {
    db.tables.account_deletion_requests.push({ id: uid(), athlete_id: ME, status: 'pending', created_at: '2026-11-20T00:00:00Z' });
    const res = await admin.POST(req('POST', { athleteId: ME }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, steps: { database: 'ok', storage: 'ok', chat: 'ok', login: 'ok' } });
    expect(rpc).toHaveBeenCalledWith('anonymise_athlete', { target: ME, admin_id: ADMIN });
    expect(removed.avatars).toEqual([`${ME}.jpg`]);
    expect(removed['feed-media']).toEqual([`${ME}/a.jpg`]);
    expect(removed['face-crops']).toEqual(['p1/c1.jpg']);
    expect(deleteUser).toHaveBeenCalledWith(ME, { mark_messages_deleted: true, hard_delete: true });
    expect(authDelete).toHaveBeenCalledWith('auth-1');
  });

  it('503 when the function is missing', async () => {
    db.tables.account_deletion_requests.push({ id: uid(), athlete_id: ME, status: 'pending', created_at: '2026-11-20T00:00:00Z' });
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find the function public.anonymise_athlete' } });
    expect((await admin.POST(req('POST', { athleteId: ME }))).status).toBe(503);
  });
});

describe('storagePathFromUrl', () => {
  it('strips the public prefix and the cache-buster', () => {
    expect(storagePathFromUrl('https://s/storage/v1/object/public/avatars/abc.png?v=9', 'avatars')).toBe('abc.png');
    expect(storagePathFromUrl('https://elsewhere/x.png', 'avatars')).toBeNull();
    expect(storagePathFromUrl(null, 'avatars')).toBeNull();
  });
});

describe('migration 204 — anonymise_athlete covers the app’s deletion promise', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/204_anonymise_athlete_complete.sql'), 'utf8');
  it.each([
    ['name', /SET name = /],
    ['photo', /avatar_url = NULL/],
    ['GPS points', /gps_points = '\[\]'::jsonb/],
    ['streams', /DELETE FROM activity_streams/],
    ['Garmin token', /'garmin_auth'/],
    ['Strava token', /'strava_auth'/],
    ['comment bodies', /UPDATE feed_comments SET body = ''/],
    ['meetup chat', /UPDATE run_meetup_messages SET body = ''/],
    ['feedback thread', /UPDATE workout_feedback_messages SET body = ''/],
    ['web push', /DELETE FROM push_subscriptions/],
    ['native devices', /DELETE FROM athlete_devices/],
    ['faces', /DELETE FROM athlete_faces/],
    ['locked from anon', /REVOKE ALL ON FUNCTION anonymise_athlete\(uuid, uuid\) FROM anon, authenticated/],
  ])('%s', (_label, re) => {
    expect(sql).toMatch(re);
  });
  it('never deletes the activity rows themselves (the numeric totals stay)', () => {
    expect(sql).not.toMatch(/DELETE FROM athlete_activities/);
  });
});
