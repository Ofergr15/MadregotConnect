import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/events: `notify:false` creates silently; absent keeps the club-wide push. */

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  resolveAudience: vi.fn(async () => [{ endpoint: 'sub-1' }]),
  sendPushLocalized: vi.fn(async () => ({ sent: 1 })),
  inserts: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => (h.user ? { ok: true, user: h.user } : { ok: false, status: 401 }),
  authError: (a: { status: number }) => new Response('{}', { status: a.status }),
}));
vi.mock('@/lib/push', () => ({ resolveAudience: h.resolveAudience, sendPushLocalized: h.sendPushLocalized }));
// Tripwires: no other outbound channel may be reached from this route.
vi.mock('web-push', () => { throw new Error('web-push must not load'); });
vi.mock('@/lib/email', () => { throw new Error('email must not load'); });
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let row: Record<string, unknown> = {};
      const c: any = {};
      c.insert = (r: Record<string, unknown>) => { row = r; h.inserts.push(r); return c; };
      c.select = () => c;
      c.single = async () => ({ data: { id: 'evt-1', ...row }, error: null });
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/events/route');
const BASE = { kind: 'race', name: 'Synthetic test event', date: '2026-12-06', location: 'Test' };
const post = (b: object) => POST(new Request('http://x/api/events', { method: 'POST', body: JSON.stringify(b) }));
const STAFF = { isStaff: true, isSuperUser: false, athleteId: 'coach-1' };

beforeEach(() => {
  h.user = STAFF; h.inserts = [];
  h.resolveAudience.mockClear(); h.sendPushLocalized.mockClear();
});

describe('POST /api/events — access', () => {
  it('unauthenticated → 401, nothing written, nothing sent', async () => {
    h.user = null;
    expect((await post({ ...BASE, notify: false })).status).toBe(401);
    expect(h.inserts).toHaveLength(0);
    expect(h.resolveAudience).not.toHaveBeenCalled();
  });
  it('signed-in non-staff → 403, nothing written, nothing sent', async () => {
    h.user = { isStaff: false, isSuperUser: false, athleteId: 'runner-1' };
    expect((await post({ ...BASE, notify: false })).status).toBe(403);
    expect(h.inserts).toHaveLength(0);
    expect(h.sendPushLocalized).not.toHaveBeenCalled();
  });
});

describe('POST /api/events — notify', () => {
  it('notify:false creates the record and sends nothing (audience not even resolved)', async () => {
    const res = await post({ ...BASE, notify: false });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.event).toMatchObject({ id: 'evt-1', name: 'Synthetic test event', created_by: 'coach-1' });
    expect(json.notified).toBe(false);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).not.toHaveProperty('notify');
    expect(h.resolveAudience).not.toHaveBeenCalled();
    expect(h.sendPushLocalized).not.toHaveBeenCalled();
  });
  it('regression: absent notify keeps the original club-wide push', async () => {
    const res = await post(BASE);
    expect(res.status).toBe(200);
    expect((await res.json()).notified).toBe(true);
    expect(h.resolveAudience).toHaveBeenCalledWith('all', null);
    expect(h.sendPushLocalized).toHaveBeenCalledTimes(1);
  });
  it('notify:true behaves as absent', async () => {
    await post({ ...BASE, notify: true });
    expect(h.sendPushLocalized).toHaveBeenCalledTimes(1);
  });
  it('a non-boolean notify is 400, before any write or send', async () => {
    for (const v of ['false', 0, null]) {
      expect((await post({ ...BASE, notify: v })).status).toBe(400);
    }
    expect(h.inserts).toHaveLength(0);
    expect(h.sendPushLocalized).not.toHaveBeenCalled();
  });
});
