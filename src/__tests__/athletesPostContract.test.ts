// Route-level contract for POST /api/athletes (staff invite), for a native "+ invite".
// FIXTURE only. syncApprovedJoiner (the invite mail) is stubbed and counted: nothing is sent.
// athletes.email is UNIQUE in production (migration 079), modelled here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({
  schema: {
    athletes: ['id', 'coach_id', 'name', 'email', 'status', 'approved', 'invite_token', 'group_id'],
    signup_requests: ['id', 'status', 'athlete_id', 'email'],
  },
  unique: { athletes: [['email']] },
  defaults: { athletes: () => ({ id: `a${Math.random().toString(16).slice(2)}` }) },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-session')>()), requireSession: async () => session }));
const mails: unknown[] = [];
vi.mock('@/lib/onboarding/approval-sync', () => ({ syncApprovedJoiner: async (x: unknown) => { mails.push(x); return { emailed: true, emailReason: null }; } }));

const staff = { ok: true, user: { athleteId: 'coach', isStaff: true, isSuperUser: false, email: 'c@example.test', athleteEmail: 'c@example.test' } };
const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/athletes/route');
  const res = await POST(new Request('http://x/api/athletes', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { db.tables.athletes.length = 0; db.tables.signup_requests.length = 0; mails.length = 0; session = staff; });

describe('POST /api/athletes contract', () => {
  it('401 without a session, 403 for a non-staff member; nothing inserted', async () => {
    session = { ok: false, status: 401, error: 'unauthorized' };
    expect((await post({ name: 'N', email: 'n@example.test' })).status).toBe(401);
    session = { ok: true, user: { athleteId: 'me', isStaff: false } };
    expect((await post({ name: 'N', email: 'n@example.test' })).status).toBe(403);
    expect(db.tables.athletes).toHaveLength(0);
  });
  it.each([[{ email: 'n@example.test' }], [{ name: 'N' }], [{}]])('400 when name or email is missing: %j', async (b) => {
    expect(await post(b)).toEqual({ status: 400, body: { error: 'Name and email are required' } });
  });
  it('200: normalised email, invited + pre-approved, 32-hex invite link, NO mail by default', async () => {
    const r = await post({ name: 'New', email: '  New@Example.Test ', groupId: 'g2' });
    expect(r.status).toBe(200);
    expect(r.body.athlete).toMatchObject({ name: 'New', email: 'new@example.test', status: 'invited', approved: true, group_id: 'g2' });
    expect(r.body.inviteLink).toMatch(/\/join\/[0-9a-f]{32}$/);
    expect(r.body).not.toHaveProperty('emailed');
    expect(mails).toHaveLength(0);
  });
  it('sendEmail:true mails once and reports emailed', async () => {
    const r = await post({ name: 'N', email: 'n@example.test', sendEmail: true });
    expect(r.body).toMatchObject({ emailed: true, emailReason: null });
    expect(mails).toHaveLength(1);
  });
  it('a pending public signup with that email (case-insensitive) is mailed without sendEmail', async () => {
    db.tables.signup_requests.push({ id: 's1', status: 'pending', athlete_id: null, email: 'n@example.test' });
    await post({ name: 'N', email: 'N@example.test' });
    expect(mails).toHaveLength(1);
  });
  it('FINDING: a duplicate email is 500 "Failed to create invitation" (unique violation), not 409', async () => {
    await post({ name: 'A', email: 'dup@example.test' });
    const r = await post({ name: 'B', email: 'DUP@example.test' });
    expect(r).toEqual({ status: 500, body: { error: 'Failed to create invitation' } });
    expect(db.tables.athletes).toHaveLength(1);
  });
  it('publicLink:true makes a placeholder invited row and returns only {inviteLink}', async () => {
    const r = await post({ publicLink: true });
    expect(Object.keys(r.body)).toEqual(['inviteLink']);
    expect(db.tables.athletes[0]).toMatchObject({ name: 'Public Invite', status: 'invited' });
    expect(db.tables.athletes[0].email).toMatch(/^public-[0-9a-f]{32}@invite\.madregot\.app$/);
  });
});
