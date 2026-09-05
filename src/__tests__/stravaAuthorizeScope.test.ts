import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `GET /api/strava?athleteId=…` was a complete account takeover, and the whole
 * credential was a bare athlete UUID.
 *
 * The route mints a Strava authorize URL whose OAuth `state` is the athlete id
 * verbatim. Strava echoes `state` back, and the callback's link mode writes the
 * returning tokens onto the athlete row `state` names:
 *
 *     .update({ strava_auth, strava_athlete_id, strava_enabled, data_source })
 *     .eq('id', state)
 *
 * So an anonymous caller could ask this route for a URL carrying someone else's
 * athlete id, authorise with their OWN Strava account, and have their
 * `strava_athlete_id` stamped onto the victim's row. Login mode then resolves a
 * member by `strava_athlete_id` FIRST ("descending order of certainty"), so the
 * attacker's next ordinary "sign in with Strava" landed them inside the
 * victim's account — no password anywhere in the chain. The retired
 * `/api/auth/athlete-login` handed out those UUIDs for any email.
 *
 * The fix is a self-or-staff gate on the link branch only. `mode=login` has to
 * stay open — it is the sign-in entry point on the public landing page, where
 * there is no session yet and the state it mints names nobody. That asymmetry
 * is the thing worth pinning: a future tidy-up that gates the whole route
 * breaks sign-in for everyone, and one that gates neither reopens this.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

const ME = '11111111-1111-1111-1111-111111111111';
const VICTIM = '22222222-2222-2222-2222-222222222222';

const session = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  user: {
    email: 'runner@madregot.local',
    athleteId: ME,
    name: 'Runner',
    role: 'runner',
    groupId: null,
    athleteStatus: 'active',
    isStaff: false,
    isSuperUser: false,
    canApprove: false,
    ...over,
  },
});

const { GET } = await import('@/app/api/strava/route');

const get = (qs: string) => GET(new Request(`https://example.test/api/strava${qs}`));

/** The `state` the route actually put in the authorize URL. */
async function stateOf(res: Response): Promise<string | null> {
  const { authUrl } = await res.json();
  return new URL(authUrl).searchParams.get('state');
}

beforeEach(() => {
  requireSession.mockReset();
  process.env.STRAVA_CLIENT_ID = 'test-client-id';
});

describe('GET /api/strava — link branch', () => {
  it('refuses an anonymous caller naming an athlete id', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await get(`?athleteId=${VICTIM}`);
    expect(res.status).toBe(401);
  });

  // The takeover itself: a real, logged-in member pointing the flow at somebody
  // else. This used to answer 200 with the victim's id as `state`.
  it('refuses a runner naming somebody else', async () => {
    requireSession.mockResolvedValue(session());
    const res = await get(`?athleteId=${VICTIM}`);
    expect(res.status).toBe(403);
  });

  it('lets a runner connect their own Strava', async () => {
    requireSession.mockResolvedValue(session());
    const res = await get(`?athleteId=${ME}`);
    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe(ME);
  });

  it('lets a coach connect anyone — that is what the athletes page does', async () => {
    requireSession.mockResolvedValue(session({ role: 'coach', isStaff: true }));
    const res = await get(`?athleteId=${VICTIM}`);
    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe(VICTIM);
  });

  it('honours mode=link the same way, since that reaches the same branch', async () => {
    requireSession.mockResolvedValue(session());
    const res = await get(`?mode=link&athleteId=${VICTIM}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/strava — login branch stays open', () => {
  // No session exists yet on the landing page, so requiring one here would lock
  // every new and returning user out of the app entirely.
  it('serves an anonymous caller asking to sign in', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await get('?mode=login');
    expect(res.status).toBe(200);
    expect(requireSession).not.toHaveBeenCalled();
  });

  // The bare-URL default is login too (DevIdentitySwitcher and older callers).
  it('treats a request with no parameters as login, not as a link', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await get('');
    expect(res.status).toBe(200);
    expect(requireSession).not.toHaveBeenCalled();
  });

  // Login state must never be mistakable for an athlete id, or the callback
  // would take the link branch and update a row named by attacker input.
  it('never mints a login state that looks like a bare uuid', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const state = await stateOf(await get('?mode=login'));
    expect(state).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
