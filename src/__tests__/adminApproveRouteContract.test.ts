// Route-level contract for POST /api/admin/approve, for a native entry queue.
// FIXTURE only. Every outbound effect (email, push, maintenance release, joiner
// sync, onboarding event) is stubbed and counted: nothing is sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({
  schema: {
    athletes: ['id', 'name', 'email', 'approved', 'approved_at', 'approved_by', 'is_academy', 'garmin_auth', 'invite_token', 'group_id', 'first_seen_at', 'strava_auth', 'status'],
    signup_requests: ['id', 'athlete_id', 'status', 'notify_email', 'email'],
    groups: ['id', 'name'],
  },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-session')>()), requireSession: async () => session }));
const fx: Record<string, number> = {};
const count = (k: string) => async () => { fx[k] = (fx[k] ?? 0) + 1; return {}; };
vi.mock('@/lib/maintenance-release', () => ({ releaseFromMaintenance: count('release') }));
vi.mock('@/lib/email', () => ({ notifyUserApproved: count('mailUser'), notifyAdminUserApproved: count('mailAdmin'), notifyAcademyApproved: count('mailAcademy') }));
vi.mock('@/lib/push', () => ({ notifyAthlete: count('push') }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: count('onb'), deviceFromUa: () => null }));
vi.mock('@/lib/onboarding/approval-sync', () => ({ syncApprovedJoiner: count('sync') }));

const approver = { ok: true, user: { athleteId: 'coach', isStaff: true, canApprove: true, isSuperUser: false, email: 'c@example.test', athleteEmail: 'c@example.test' } };
const call = async (body: unknown) => {
  const { POST } = await import('@/app/api/admin/approve/route');
  const res = await POST(new NextRequest('http://x/api/admin/approve', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const row = (id: string) => db.tables.athletes.find((r) => r.id === id)!;
const outbound = () => (fx.mailUser ?? 0) + (fx.mailAcademy ?? 0) + (fx.push ?? 0);

beforeEach(() => {
  for (const t of Object.values(db.tables)) t.length = 0;
  for (const k of Object.keys(fx)) delete fx[k];
  db.tables.athletes.push(
    { id: 'p', name: 'P', email: 'p@example.test', approved: false, is_academy: false, group_id: 'g1', status: 'active' },
    { id: 'nogroup', name: 'N', email: 'n@example.test', approved: false, is_academy: false, group_id: null, status: 'active' },
  );
  session = approver;
});

describe('POST /api/admin/approve contract', () => {
  it('401 without a session', async () => {
    session = { ok: false, status: 401, error: 'unauthorized' };
    expect((await call({ athleteId: 'p' })).status).toBe(401);
    expect(row('p').approved).toBe(false);
  });
  it('403 for staff WITHOUT canApprove (role is not enough)', async () => {
    session = { ok: true, user: { ...approver.user, canApprove: false } };
    expect((await call({ athleteId: 'p' })).status).toBe(403);
    expect(row('p').approved).toBe(false);
    expect(outbound()).toBe(0);
  });
  it('400 without athleteId; 404 for an unknown id', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ athleteId: 'ghost' })).status).toBe(404);
  });
  it('400 group_required for a club applicant with no pack', async () => {
    expect(await call({ athleteId: 'nogroup' })).toMatchObject({ status: 400, body: { error: 'group_required' } });
    expect(row('nogroup').approved).toBe(false);
  });
  it('200 approves, stamps approved_by, and notifies once', async () => {
    const r = await call({ athleteId: 'p' });
    expect(r.status).toBe(200);
    expect(row('p')).toMatchObject({ approved: true, approved_by: 'c@example.test' });
    expect(outbound()).toBeGreaterThanOrEqual(1);
  });
  it('REPLAY: a second approve is 200 "Already approved", with no second approval mail or push', async () => {
    await call({ athleteId: 'p' });
    const sent = outbound();
    const stamp = row('p').approved_at;
    const r = await call({ athleteId: 'p' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ message: 'Already approved', approved: true });
    expect(row('p').approved_at).toBe(stamp);
    expect(outbound()).toBe(sent);
  });
});
