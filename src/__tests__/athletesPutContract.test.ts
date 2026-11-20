// Route-level contract for PUT /api/athletes, for the native profile/roster editor.
// FIXTURE data only. Side effects after the write (pack history, notifications,
// follows, academy membership) are stubbed and only counted — nothing is sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

const db = createMemoryDb({
  schema: { athletes: ['id', 'coach_id', 'group_id', 'status', 'is_academy', 'pending_group_id', 'pending_group_from', 'name'] },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async () => session,
}));
const effects = { afterPackMove: 0, notifyPackScheduled: 0, applyAcademyMembership: 0, syncClubFollows: 0 };
vi.mock('@/lib/groups/pack-move', () => ({
  afterPackMove: async () => { effects.afterPackMove++; },
  notifyPackScheduled: async () => { effects.notifyPackScheduled++; },
}));
vi.mock('@/lib/academy/membership-server', () => ({ applyAcademyMembership: async () => { effects.applyAcademyMembership++; } }));
vi.mock('@/lib/follows/club-sync', () => ({ syncClubFollows: async () => { effects.syncClubFollows++; } }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void fn(); } }));

const as = (athleteId: string | null, isStaff: boolean) => ({ ok: true, user: { athleteId, isStaff, email: 'x@example.test', role: isStaff ? 'coach' : 'runner' } });
const put = async (body: unknown) => {
  const { PUT } = await import('@/app/api/athletes/route');
  const res = await PUT(new Request('http://x/api/athletes', { method: 'PUT', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const row = (id: string) => db.tables.athletes.find((r) => r.id === id)!;

beforeEach(() => {
  db.tables.athletes.length = 0;
  db.tables.athletes.push(
    { id: 'me', coach_id: COACH_ID, group_id: 'g1', status: 'active', is_academy: false, pending_group_id: 'g3', pending_group_from: '2026-11-21', name: 'Me' },
    { id: 'other', coach_id: COACH_ID, group_id: 'g2', status: 'active', is_academy: false, pending_group_id: null, pending_group_from: null, name: 'Other' },
    { id: 'foreign', coach_id: 'another-coach', group_id: 'g1', status: 'active', is_academy: false, pending_group_id: null, pending_group_from: null, name: 'F' },
  );
  for (const k of Object.keys(effects)) (effects as any)[k] = 0;
});

describe('PUT /api/athletes contract', () => {
  it('401 without a session, nothing written', async () => {
    session = { ok: false, status: 401, error: 'unauthorized' };
    expect((await put({ id: 'me', groupId: 'g2' })).status).toBe(401);
    expect(row('me').group_id).toBe('g1');
  });
  it('400 without id', async () => {
    session = as('me', false);
    expect((await put({ groupId: 'g2' })).status).toBe(400);
  });
  it('403 for a member editing someone else', async () => {
    session = as('me', false);
    const r = await put({ id: 'other', groupId: 'g1' });
    expect(r).toEqual({ status: 403, body: { error: 'You can only update your own profile' } });
    expect(row('other').group_id).toBe('g2');
  });
  it.each([['status', { status: 'archived' }], ['isAcademy', { isAcademy: true }]])('403 for a member setting the staff-only %s on themselves', async (_k, patch) => {
    session = as('me', false);
    const r = await put({ id: 'me', ...patch });
    expect(r).toEqual({ status: 403, body: { error: 'Staff access required for this change' } });
    expect(row('me')).toMatchObject({ status: 'active', is_academy: false });
  });
  it('FINDING: a member MAY move their own group immediately (groupId is not staff-only); it clears their pending change', async () => {
    session = as('me', false);
    const r = await put({ id: 'me', groupId: 'g2' });
    expect(r.status).toBe(200);
    expect(row('me')).toMatchObject({ group_id: 'g2', pending_group_id: null, pending_group_from: null });
    expect(effects.afterPackMove).toBe(1);
  });
  it('staff move + status + academy: 200, returns the row, runs each after-effect once', async () => {
    session = as('coach', true);
    const r = await put({ id: 'other', groupId: 'g3', status: 'active', isAcademy: true });
    expect(r.status).toBe(200);
    expect(r.body.athlete).toMatchObject({ id: 'other', group_id: 'g3', is_academy: true });
    expect(effects).toEqual({ afterPackMove: 1, notifyPackScheduled: 0, applyAcademyMembership: 1, syncClubFollows: 1 });
  });
  it('same group again: 200 but no pack-move effect', async () => {
    session = as('coach', true);
    await put({ id: 'other', groupId: 'g2' });
    expect(effects.afterPackMove).toBe(0);
  });
  it('pendingGroupId: self 200 schedules without notifying; null cancels', async () => {
    session = as('me', false);
    const r = await put({ id: 'me', pendingGroupId: 'g2' });
    expect(r.status).toBe(200);
    expect(r.body.pendingGroup.groupId).toBe('g2');
    expect(effects.notifyPackScheduled).toBe(0);
    expect((await put({ id: 'me', pendingGroupId: null })).body).toEqual({ pendingGroup: null });
    expect(row('me')).toMatchObject({ pending_group_id: null, pending_group_from: null });
  });
  it('pendingGroupId by staff for someone else notifies them; by a member for someone else is 403', async () => {
    session = as('coach', true);
    expect((await put({ id: 'other', pendingGroupId: 'g1' })).status).toBe(200);
    expect(effects.notifyPackScheduled).toBe(1);
    session = as('me', false);
    expect((await put({ id: 'other', pendingGroupId: 'g3' })).status).toBe(403);
  });
  it('FIXED (B27): an athlete of another coach is 403 "Athlete not in this club", not 500', async () => {
    session = as('coach', true);
    const r = await put({ id: 'foreign', groupId: 'g2' });
    expect(r).toEqual({ status: 403, body: { error: 'Athlete not in this club' } });
    expect(row('foreign').group_id).toBe('g1');
  });
  it('FIXED (B26): a malformed or non-object JSON body is 400', async () => {
    session = as('me', false);
    const { PUT } = await import('@/app/api/athletes/route');
    for (const raw of ['{', 'null', '7']) {
      const res = await PUT(new Request('http://x/api/athletes', { method: 'PUT', body: raw }));
      expect(res.status).toBe(400);
    }
  });
});
