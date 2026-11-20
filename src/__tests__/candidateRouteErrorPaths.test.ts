import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Error paths through the real handlers (mock DB, spied providers): a failing write or read must give
 * an error status, never a half-done success, and must send nothing. Synthetic only.
 */
const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  fail: '' as '' | 'insert' | 'select',
  push: { resolveAudience: vi.fn(async () => [{ endpoint: 'x' }]), sendPushLocalized: vi.fn(), notifyAthlete: vi.fn() },
}));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async () => (h.user ? { ok: true, user: h.user } : { ok: false, status: 401, error: 'unauthorized' }),
}));
vi.mock('@/lib/push', () => h.push);
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      for (const m of ['select', 'eq']) c[m] = () => c;
      c.insert = () => ({ select: () => ({ single: async () => (h.fail === 'insert'
        ? { data: null, error: { code: 'XX000', message: 'insert failed' } } : { data: { id: 'e1' }, error: null }) }) });
      c.maybeSingle = async () => { if (h.fail === 'select') throw new Error('read failed'); return { data: null, error: null }; };
      return c;
    },
  }),
}));

const events = await import('@/app/api/events/route');
const caps = await import('@/app/api/me/capabilities/route');
const STAFF = { email: 's@example.test', athleteEmail: null, athleteId: 'st-1', name: 'S', role: 'admin', roles: ['admin'], isStaff: true,
  isSuperUser: false, canApprove: true, isCoreRunner: false, groupId: null, athleteStatus: 'active' };
const post = (b: unknown, raw?: string) => events.POST(new Request('http://x/api/events', { method: 'POST', body: raw ?? JSON.stringify(b) }));
const BASE = { kind: 'race', name: 'Synthetic', date: '2026-12-06', location: 'X' };
const sent = () => h.push.resolveAudience.mock.calls.length + h.push.sendPushLocalized.mock.calls.length + h.push.notifyAthlete.mock.calls.length;

beforeEach(() => { h.user = STAFF; h.fail = ''; for (const f of Object.values(h.push)) f.mockClear(); });

describe('POST /api/events error paths', () => {
  it('insert fails → 500, and the club push never runs (even without notify:false)', async () => {
    h.fail = 'insert';
    expect((await post(BASE)).status).toBe(500);
    expect(sent()).toBe(0);
  });
  it('malformed JSON body → an error status, no push', async () => {
    const res = await post(null, '{not json');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sent()).toBe(0);
  });
  it('a push failure after a good insert never fails the create (existing best-effort contract)', async () => {
    h.push.sendPushLocalized.mockRejectedValueOnce(new Error('push down'));
    const res = await post(BASE);
    expect(res.status).toBe(200);
    expect((await res.json()).notified).toBe(true);
  });
});

describe('GET /api/me/capabilities error paths', () => {
  it('a failed settings read → 500 with no capability body (never a guessed grant)', async () => {
    h.fail = 'select';
    const res = await caps.GET(new Request('http://x/api/me/capabilities'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'failed' });
    expect(sent()).toBe(0);
  });
});
