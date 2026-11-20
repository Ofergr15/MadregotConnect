import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/academy/threads/inbox makes one write: an academy manager who is not yet a
 * member of a thread is added to it. That write must never happen for a coach-scoped read,
 * a plain coach, an admin viewing as someone, or a `?join=0` read. No real Stream request.
 */

const ME = 'mgr-1';
const h = vi.hoisted(() => ({
  caller: null as null | Record<string, unknown>,
  addMembers: vi.fn(async () => ({})),
  upsertUsers: vi.fn(async () => {}),
  query: vi.fn(),
  dbWrites: 0,
}));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => (h.caller ? { denied: null, caller: h.caller }
    : { denied: new Response('{}', { status: 401 }), caller: null }),
}));
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({ queryChannels: h.query }),
  upsertStreamUsersFromAthletes: h.upsertUsers,
}));
vi.mock('@/lib/academy/trainee-coaches', async (orig) => ({
  ...(await orig<typeof import('@/lib/academy/trainee-coaches')>()),
  coachIdsByTrainee: async () => new Map([['t1', [ME]], ['t2', ['other-coach']]]),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      for (const m of ['select', 'eq']) c[m] = () => c;
      for (const m of ['insert', 'update', 'upsert', 'delete']) c[m] = () => { h.dbWrites++; return c; };
      c.maybeSingle = async () => ({ data: null, error: null });
      c.then = (r: (v: unknown) => unknown) => r({ data: [
        { id: 't1', name: 'Trainee A', is_academy: true, academy_coach_id: ME },
        { id: 't2', name: 'Trainee B', is_academy: true, academy_coach_id: 'other-coach' },
      ], error: null });
      return c;
    },
  }),
}));

const { academyChannelId } = await import('@/lib/academy/thread');
const { GET } = await import('@/app/api/academy/threads/inbox/route');
const get = (q = '') => GET(new Request(`http://x/api/academy/threads/inbox${q}`));
const channel = (athleteId: string) => ({
  id: academyChannelId(athleteId),
  state: { members: {}, messages: [], read: {} }, // the manager is NOT a member yet
  countUnread: () => 0,
  addMembers: h.addMembers,
});
const MANAGER = { athleteId: ME, isStaff: true, isSuperUser: false, role: 'academy_manager', roles: ['academy_manager'], email: 'm@example.test' };

beforeEach(() => {
  h.caller = null; h.dbWrites = 0;
  h.addMembers.mockClear(); h.upsertUsers.mockClear();
  h.query.mockReset().mockImplementation(async (filter: { id: { $in: string[] } }) =>
    filter.id.$in.map((id) => channel(id.replace(academyChannelId(''), ''))));
});

const noWrites = () => {
  expect(h.addMembers).not.toHaveBeenCalled();
  expect(h.upsertUsers).not.toHaveBeenCalled();
  expect(h.dbWrites).toBe(0);
};

describe('academy inbox — the manager self-join is the only write, and only when intended', () => {
  it('no session → 401; non-staff → 403; neither reaches Stream', async () => {
    expect((await get()).status).toBe(401);
    h.caller = { athleteId: 'r1', isStaff: false, isSuperUser: false, role: 'runner', email: 'r@example.test' };
    expect((await get()).status).toBe(403);
    expect(h.query).not.toHaveBeenCalled();
    noWrites();
  });
  it('regression: a manager reading the academy view still joins threads (existing behaviour)', async () => {
    h.caller = MANAGER;
    const res = await get();
    expect((await res.json()).scope).toBe('academy');
    expect(h.addMembers).toHaveBeenCalledTimes(2);
    expect(h.dbWrites).toBe(0);
  });
  it('a manager with ?scope=coach: own trainees only, no join', async () => {
    h.caller = MANAGER;
    const j = await (await get('?scope=coach')).json();
    expect(j.scope).toBe('coach');
    expect(j.rows.map((r: { athleteId: string }) => r.athleteId)).toEqual(['t1']);
    noWrites();
  });
  it('a plain coach (no manager role): own trainees, no join, queried as themselves', async () => {
    h.caller = { athleteId: ME, isStaff: true, isSuperUser: false, role: 'coach', roles: ['coach'], email: 'c@example.test' };
    await get();
    expect(h.query.mock.calls[0][2]).toMatchObject({ user_id: ME, state: true });
    expect(h.query.mock.calls[0][2]).not.toHaveProperty('watch');
    noWrites();
  });
  it('a manager with ?join=0: full academy read, no join', async () => {
    h.caller = MANAGER;
    expect((await (await get('?join=0')).json()).scope).toBe('academy');
    noWrites();
  });
  it('an admin viewing as a manager: no join (it would add the viewed person to every thread)', async () => {
    h.caller = { ...MANAGER, viewingAsBy: 'admin@example.test' };
    await get();
    noWrites();
  });
});
