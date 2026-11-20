import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/me/capabilities — least privilege, read-only, view-as never carries the admin's rights. */

const h = vi.hoisted(() => ({
  auth: null as null | { ok: true; user: Record<string, unknown> } | { ok: false; status: number },
  settings: {} as Record<string, string>,
  writes: 0,
  outbound: vi.fn(),
}));

vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async () => h.auth ?? { ok: false, status: 401 },
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: h.outbound, sendPushLocalized: h.outbound, resolveAudience: h.outbound }));
vi.mock('@/lib/email', () => { throw new Error('email must not load'); });
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let key = '';
      const c: any = {};
      c.select = () => c;
      c.eq = (_: string, v: string) => { key = v; return c; };
      c.maybeSingle = async () => ({ data: key in h.settings ? { value: h.settings[key] } : null, error: null });
      for (const m of ['insert', 'update', 'upsert', 'delete']) c[m] = () => { h.writes++; return c; };
      return c;
    },
  }),
}));

const { GET } = await import('@/app/api/me/capabilities/route');
const get = async () => GET(new Request('http://x/api/me/capabilities'));
const base = { email: 'x@example.test', athleteEmail: null, name: 'X', groupId: null, athleteStatus: 'active',
  isStaff: false, isSuperUser: false, canApprove: false, isCoreRunner: false, roles: [] as string[] };
const as = (over: Record<string, unknown>) => { h.auth = { ok: true, user: { ...base, ...over } }; };

const NONE = { viewingAs: false, events: { manage: false }, messages: 'none',
  clubUpdates: { read: false, write: false, admin: false }, people: { read: false, admin: false }, approve: false, viewAs: false };

beforeEach(async () => {
  h.auth = null; h.settings = {}; h.writes = 0; h.outbound.mockClear();
});

describe('GET /api/me/capabilities', () => {
  it('no session → 401', async () => {
    expect((await get()).status).toBe(401);
  });
  it('a runner with no grants gets nothing', async () => {
    as({ athleteId: 'r1', role: 'runner' });
    expect(await (await get()).json()).toEqual(NONE);
  });
  it('a missing / unknown role is treated as nothing, not as staff', async () => {
    as({ athleteId: 'r2', role: '' });
    expect(await (await get()).json()).toEqual(NONE);
    as({ athleteId: 'r3', role: 'mystery' });
    expect(await (await get()).json()).toEqual(NONE);
  });
  it('a coach: events + people read; NOT approve, people admin, view-as or messages without canApprove', async () => {
    as({ athleteId: 'c1', role: 'coach', isStaff: true });
    expect(await (await get()).json()).toEqual({ ...NONE, events: { manage: true }, people: { read: true, admin: false } });
  });
  it('an approver publishes messages and approves; that alone is not staff', async () => {
    as({ athleteId: 'a1', role: 'runner', canApprove: true });
    const j = await (await get()).json();
    expect(j).toMatchObject({ messages: 'publish', approve: true, events: { manage: false }, people: { read: false, admin: false } });
  });
  it('a messages grant: level 2 → draft, level 3 → publish (grant only, as publishGate reads it)', async () => {
    for (const [lvl, want] of [[2, 'draft'], [3, 'publish'], [1, 'none']] as const) {
      vi.resetModules(); // readGrants caches for 60 s per module instance
      const fresh = await import('@/app/api/me/capabilities/route');
      h.settings.access_grants = JSON.stringify({ g1: { content: { messages: lvl } } });
      as({ athleteId: 'g1', role: 'runner' });
      const j = await (await fresh.GET(new Request('http://x/api/me/capabilities'))).json();
      expect(j.messages).toBe(want);
      expect(j.events.manage).toBe(false);
    }
  });
  it('an admin: everything', async () => {
    as({ athleteId: 'ad', role: 'admin', isStaff: true, canApprove: true });
    expect(await (await get()).json()).toEqual({ viewingAs: false, events: { manage: true }, messages: 'publish',
      clubUpdates: { read: true, write: true, admin: true }, people: { read: true, admin: true }, approve: true, viewAs: true });
  });
  it('view-as: the admin viewing a runner gets the runner answer and no write at all', async () => {
    as({ athleteId: 'r1', role: 'runner', viewingAsBy: 'admin@example.test' });
    expect(await (await get()).json()).toEqual({ ...NONE, viewingAs: true });
    as({ athleteId: 'ad2', role: 'admin', isStaff: true, viewingAsBy: 'admin@example.test' });
    const j = await (await get()).json();
    expect(j).toMatchObject({ viewingAs: true, events: { manage: false }, messages: 'none', approve: false, viewAs: false,
      people: { read: true, admin: false }, clubUpdates: { write: false, admin: false } });
  });
  it('club updates: enabled + named writer may write; others only read', async () => {
    h.settings.club_updates = JSON.stringify({ enabled: true, writerIds: ['w1'] });
    as({ athleteId: 'w1', role: 'runner' });
    expect((await (await get()).json()).clubUpdates).toEqual({ read: true, write: true, admin: false });
    as({ athleteId: 'w2', role: 'runner' });
    expect((await (await get()).json()).clubUpdates).toEqual({ read: true, write: false, admin: false });
  });
  it('never writes and never sends', async () => {
    for (const u of [{ role: 'admin', isStaff: true, canApprove: true }, { role: 'runner' }]) { as({ athleteId: 'z', ...u }); await get(); }
    expect(h.writes).toBe(0);
    expect(h.outbound).not.toHaveBeenCalled();
  });
});
