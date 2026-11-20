// Runs the REAL requireStaffCaller / resolveVerifiedCaller; only the session
// lookup (JWT verify) and maintenance read underneath are stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.fn();
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: (...a: unknown[]) => session(...a),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
const from = vi.fn(() => ({ select: () => ({ order: async () => ({ data: [{ id: 'a1', name: 'A', data_source: 'strava', strava_auth: 'enc-s', strava_enabled: true, garmin_auth: null }], error: null }) }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from }) }));

const user = (role: string, isStaff: boolean) => ({
  ok: true, user: { email: 'x@example.test', athleteEmail: 'x@example.test', athleteId: 'me', role, roles: [role], isStaff, isSuperUser: false, canApprove: false, isCoreRunner: false },
});
const req = (auth?: string) => new Request('http://x/api/admin/athlete-source', auth ? { headers: { authorization: auth } } : {});

beforeEach(() => { session.mockReset(); from.mockClear(); });

describe('GET /api/admin/athlete-source through the real staff gate', () => {
  it('anonymous -> 401, roster never read', async () => {
    session.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const { GET } = await import('@/app/api/admin/athlete-source/route');
    expect((await GET(req())).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it('signed-in runner -> 403, roster never read', async () => {
    session.mockResolvedValue(user('runner', false));
    const { GET } = await import('@/app/api/admin/athlete-source/route');
    expect((await GET(req('Bearer t'))).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
  for (const role of ['admin', 'coach', 'academy_coach']) {
    it(`${role} -> 200 with booleans only`, async () => {
      session.mockResolvedValue(user(role, true));
      const { GET } = await import('@/app/api/admin/athlete-source/route');
      const res = await GET(req('Bearer t'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.athletes).toEqual([{ id: 'a1', name: 'A', dataSource: 'strava', hasGarmin: false, hasStrava: true, stravaEnabled: true }]);
      expect(JSON.stringify(body)).not.toContain('enc-s');
    });
  }
});
