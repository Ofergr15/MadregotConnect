import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The approver is the VERIFIED session, never a body field. A caller who names an
 * approver in the body (`approverEmail`, `email`) gains nothing: 401 without a session,
 * 403 without canApprove, and on a real approval `approved_by` is the session's address.
 */

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  outbound: vi.fn(),
  sync: vi.fn(async (_: Record<string, unknown>) => ({ ok: true })),
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => (h.user ? { ok: true, user: h.user } : { ok: false, status: 401 }),
  authError: (a: { status: number }) => new Response('{}', { status: a.status }),
}));
vi.mock('@/lib/maintenance-release', () => ({ releaseFromMaintenance: async () => ({ released: false, on: false }) }));
vi.mock('@/lib/email', () => ({ notifyUserApproved: h.outbound, notifyAdminUserApproved: h.outbound, notifyAcademyApproved: h.outbound }));
vi.mock('@/lib/push', () => ({ notifyAthlete: h.outbound }));
vi.mock('@/lib/onboarding/approval-sync', () => ({ syncApprovedJoiner: h.sync }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: async () => {}, deviceFromUa: () => 'test' }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) c[m] = () => c;
      c.single = async () => ({ data: { id: 'ath-1', name: 'Synthetic', email: 'synthetic@example.test', approved: false, group_id: 'g1', first_seen_at: null }, error: null });
      c.maybeSingle = async () => ({ data: null, error: null });
      // Models the conditional approve write (B30, a71affb4 patch 9): update → eq → or → select
      // returns the row it flipped. Awaiting update().eq() directly (older writes) still works.
      c.update = (r: Record<string, unknown>) => {
        h.updates.push(r);
        const w: any = {
          eq: () => w,
          or: () => w,
          select: async () => ({ data: [{ id: 'ath-1' }], error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return w;
      };
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/admin/approve/route');
const SPOOF = { athleteId: 'ath-1', approverEmail: 'real-approver@example.test', email: 'real-approver@example.test' };
const post = (b: object) => POST(new Request('http://x/api/admin/approve', { method: 'POST', body: JSON.stringify(b) }) as any);

beforeEach(() => { h.user = null; h.updates = []; h.outbound.mockClear(); h.sync.mockClear(); });

describe('POST /api/admin/approve — identity comes from the session', () => {
  it('no session + an approver named in the body → 401, nothing written or sent', async () => {
    expect((await post(SPOOF)).status).toBe(401);
    expect(h.updates).toHaveLength(0);
    expect(h.outbound).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });
  it('a member without canApprove + an approver named in the body → 403, nothing written or sent', async () => {
    h.user = { email: 'runner@example.test', athleteEmail: 'runner@example.test', canApprove: false, isSuperUser: false };
    expect((await post(SPOOF)).status).toBe(403);
    expect(h.updates).toHaveLength(0);
    expect(h.outbound).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });
  it('a real approver: approved_by is the session address, not the body field', async () => {
    h.user = { email: 'strava_1@x.local', athleteEmail: 'session-approver@example.test', canApprove: true, isSuperUser: false };
    expect((await post(SPOOF)).status).toBe(200);
    expect(h.updates[0]).toMatchObject({ approved: true, approved_by: 'session-approver@example.test' });
    expect(h.sync.mock.calls[0][0]).toMatchObject({ approverEmail: 'session-approver@example.test' });
    expect(JSON.stringify(h.updates)).not.toContain('real-approver@');
  });
});
