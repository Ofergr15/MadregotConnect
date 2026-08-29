import { describe, expect, it, vi, beforeEach } from 'vitest';

// requireMember/requireStaff are the two gates that decide, from a verified
// session alone, whether a request may proceed — so the session lookup is the
// only thing worth faking here.
const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

const { requireMember, requireStaff } = await import('@/lib/auth/self-or-staff');

const request = new Request('https://example.test/api/plans/weeks');

const session = (over: Partial<{ email: string; athleteId: string | null; isStaff: boolean }> = {}) => ({
  ok: true as const,
  user: {
    email: 'runner@madregot.local',
    athleteId: '11111111-1111-1111-1111-111111111111',
    name: 'Runner',
    role: 'runner',
    groupId: null,
    athleteStatus: 'active',
    isStaff: false,
    ...over,
  },
});

beforeEach(() => requireSession.mockReset());

describe('requireMember', () => {
  it('lets a plain runner through — this is the gate for club-wide content', async () => {
    requireSession.mockResolvedValue(session());
    expect(await requireMember(request)).toBeNull();
  });

  it('lets staff through too', async () => {
    requireSession.mockResolvedValue(session({ isStaff: true }));
    expect(await requireMember(request)).toBeNull();
  });

  it('passes the session failure straight back, preserving its status', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const denied = await requireMember(request);
    expect(denied?.status).toBe(401);
  });

  // requireSession itself rejects a valid Supabase user with no athletes/coaches
  // row, which is what makes this "belongs to this club", not merely "logged in".
  it('rejects a signed-in account with no membership', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 403, error: 'No membership found for this account' });
    const denied = await requireMember(request);
    expect(denied?.status).toBe(403);
  });
});

// The distinction that matters: the same runner requireMember admits must be
// turned away by requireStaff.
describe('requireStaff', () => {
  it('rejects a runner with 403', async () => {
    requireSession.mockResolvedValue(session());
    const denied = await requireStaff(request);
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: 'Staff access required' });
  });

  it('accepts staff', async () => {
    requireSession.mockResolvedValue(session({ isStaff: true }));
    expect(await requireStaff(request)).toBeNull();
  });

  it('accepts a coaches-only account with no athletes row', async () => {
    requireSession.mockResolvedValue(session({ isStaff: true, athleteId: null }));
    expect(await requireStaff(request)).toBeNull();
  });
});
