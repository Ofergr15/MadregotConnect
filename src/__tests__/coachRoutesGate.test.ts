import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * The coach screens' routes: every read and write is staff, except the
 * availability write, which is self-or-staff with `set_by` taken from the caller.
 * The real gates in lib/auth/self-or-staff.ts run here — only the session is faked.
 */

let user: any;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));

const updates: any[] = [];
const notified: any[] = [];
const messaged: any[] = [];
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async (o: any) => { notified.push(o); return { recipients: 1, sent: 1 }; } }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async (o: any) => { messaged.push(o); return { subscriptions: 0, delivered: 0 }; } }));
const computeRoster = vi.fn(async () => ({ runners: [], meta: {} }));
vi.mock('@/lib/coach/roster-server', () => ({ computeRoster: (...a: unknown[]) => computeRoster(...(a as [])), readLists: async () => null }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
        update: (u: any) => { updates.push(u); return q; },
        insert: () => q, delete: () => q, upsert: async () => ({ error: null }),
        single: async () => ({ data: { id: 'l1' }, error: null }),
        maybeSingle: async () => ({ data: { id: 'a1', name: 'רץ', avatar_url: null, availability: 'injured', availability_set_by: 'self' }, error: null }),
        then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return q;
    },
  }),
}));

const runner = { email: 'r@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: 'a1', role: 'runner', isCoreRunner: false };
const teammate = { ...runner, athleteId: 'a2' };
const coach = { ...runner, athleteId: 'c1', role: 'coach', isStaff: true };

const req = (url: string, body?: unknown, method = body ? 'POST' : 'GET') =>
  new Request(`http://x${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: 'Bearer t' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const roster = await import('@/app/api/coach/roster/route');
const athlete = await import('@/app/api/coach/athlete/[id]/route');
const message = await import('@/app/api/coach/message/route');
const lists = await import('@/app/api/coach/lists/route');
const list = await import('@/app/api/coach/lists/[id]/route');
const availability = await import('@/app/api/athletes/[id]/availability/route');

beforeEach(() => { updates.length = 0; notified.length = 0; messaged.length = 0; computeRoster.mockClear(); });

describe('staff-only coach routes', () => {
  it('refuse a runner — including about themself', async () => {
    user = runner;
    expect((await roster.GET(req('/api/coach/roster'))).status).toBe(403);
    expect((await athlete.GET(req('/api/coach/athlete/a1'), params('a1'))).status).toBe(403);
    expect((await message.POST(req('/api/coach/message', { athleteId: 'a2', text: 'hi' }))).status).toBe(403);
    expect((await lists.GET(req('/api/coach/lists'))).status).toBe(403);
    expect((await lists.POST(req('/api/coach/lists', { name: 'x' }))).status).toBe(403);
    expect((await list.PUT(req('/api/coach/lists/l1', { athleteId: 'a1', member: true }, 'PUT'), params('l1'))).status).toBe(403);
    expect((await list.DELETE(req('/api/coach/lists/l1', undefined, 'DELETE'), params('l1'))).status).toBe(403);
    expect(computeRoster).not.toHaveBeenCalled();
    expect(messaged).toHaveLength(0);
  });

  it('serve staff', async () => {
    user = coach;
    expect((await roster.GET(req('/api/coach/roster'))).status).toBe(200);
    expect((await roster.GET(req('/api/coach/roster?week=bad'))).status).toBe(400);
    expect((await message.POST(req('/api/coach/message', { athleteId: 'a2', text: 'בוא נדבר' }))).status).toBe(200);
    expect(messaged[0]).toMatchObject({ athleteId: 'a2', kind: 'coach_message', category: 'coach', actorAthleteId: 'c1' });
    expect((await lists.GET(req('/api/coach/lists'))).status).toBe(200);
  });

  it('refuse writes while an admin is viewing as someone', async () => {
    user = { ...coach, viewingAsBy: 'admin@x' };
    expect((await message.POST(req('/api/coach/message', { athleteId: 'a2', text: 'x' }))).status).toBe(403);
  });
});

describe('availability: self-or-staff, set_by from the caller', () => {
  it('the runner sets their own, and staff hear about it', async () => {
    user = runner;
    const res = await availability.PUT(req('/api/athletes/a1/availability', { availability: 'injured', setBy: 'coach' }, 'PUT'), params('a1'));
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ availability: 'injured', availability_set_by: 'self' });
    expect(notified[0]).toMatchObject({ kind: 'availability_change', category: 'management' });
  });
  it('a coach sets it as coach, with no alert to staff', async () => {
    user = coach;
    expect((await availability.PUT(req('/api/athletes/a1/availability', { availability: 'paused', setBy: 'self' }, 'PUT'), params('a1'))).status).toBe(200);
    expect(updates[0]).toMatchObject({ availability: 'paused', availability_set_by: 'coach' });
    expect(notified).toHaveLength(0);
  });
  it('a teammate is refused; a bad value is 400', async () => {
    user = teammate;
    expect((await availability.PUT(req('/api/athletes/a1/availability', { availability: 'injured' }, 'PUT'), params('a1'))).status).toBe(403);
    user = runner;
    expect((await availability.PUT(req('/api/athletes/a1/availability', { availability: 'gone' }, 'PUT'), params('a1'))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});

describe('source guards', () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
  it('no coach route reads identity from a header or body field', () => {
    for (const p of ['app/api/coach/roster/route.ts', 'app/api/coach/athlete/[id]/route.ts', 'app/api/coach/message/route.ts',
      'app/api/coach/lists/route.ts', 'app/api/coach/lists/[id]/route.ts', 'app/api/athletes/[id]/availability/route.ts']) {
      const src = read(p);
      expect(src).not.toMatch(/x-user-email/);
      expect(src).not.toMatch(/body\??\.(setBy|set_by|coachId|senderId|email)/);
    }
  });
  it('the roster never reads weekly_km_snapshots and never compares dayOfWeek with getDay()', () => {
    const src = read('lib/coach/roster-server.ts');
    expect(src).not.toMatch(/from\(['"]weekly_km_snapshots/);
    expect(src).not.toMatch(/getDay\(\)/);
  });
});
