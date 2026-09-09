import { describe, expect, it, vi, beforeEach } from 'vitest';

// requireSession runs on EVERY authenticated request, and it used to find the
// membership row with .maybeSingle() — which errors on more than one row instead
// of returning the first. The error was discarded, so the row read as absent, the
// coaches fallback also missed, and the athlete got 403 "No membership found" on
// every route in the app. One duplicated email = total lockout. These tests pin
// that it can't happen again, and that the row it picks matches what
// /api/auth/resolve-role hands the client at sign-in (active, then newest).

let athleteRows: Array<Record<string, unknown>>;
let coachRows: Array<Record<string, unknown>>;
let getUserEmail: string | null;
/** Every table read that reached the database, in order. */
let reads: Array<{ table: string; calls: string[] }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () =>
        getUserEmail
          ? { data: { user: { email: getUserEmail } }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } },
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record = { table, calls: [] as string[] };
      reads.push(record);
      const rows = () => (table === 'coaches' ? coachRows : athleteRows);
      const track = (fn: string) => (...args: unknown[]) => {
        record.calls.push(`${fn}(${args.map(a => JSON.stringify(a)).join(',')})`);
        return chain;
      };
      const chain: Record<string, unknown> = {
        select: track('select'),
        eq: track('eq'),
        order: track('order'),
        limit: track('limit'),
        // Deliberately absent: maybeSingle. If this path ever reaches for it
        // again, the test fails with "maybeSingle is not a function" rather than
        // silently reintroducing the lockout.
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { requireSession, clearSessionCache } = await import('@/lib/auth-session');

/** A structurally valid JWT whose only meaningful claim is a future `exp`. */
function token(seed: string): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url');
  return `header.${payload}.sig-${seed}`;
}

function request(seed: string, path = '/api/feed'): Request {
  return new Request(`https://madregot.app${path}`, {
    headers: { authorization: `Bearer ${token(seed)}` },
  });
}

/**
 * An exempt path (see lib/auth/approval-gate.ts), for the cases that are about
 * WHICH ROW resolves rather than about whether that row may see club content. A
 * non-active row now 403s on a gated route, which is the point of the gate — but
 * it would make the row-picking tests below untestable through requireSession.
 */
const OPEN = '/api/auth/me';

function athlete(over: Record<string, unknown> = {}) {
  return { id: 'a1', name: 'Runner', role: 'runner', group_id: 'g1', status: 'active', ...over };
}

beforeEach(() => {
  clearSessionCache();
  reads = [];
  coachRows = [];
  athleteRows = [athlete()];
  getUserEmail = 'runner@example.com';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

describe('requireSession — duplicate emails must not lock anyone out', () => {
  it('resolves the single-row case as before', async () => {
    const result = await requireSession(request('one'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({
      email: 'runner@example.com',
      // Null because the row's address IS the token's — it only carries a value
      // when they differ, which is what a Strava login's synthetic email causes.
      athleteEmail: null,
      athleteId: 'a1',
      name: 'Runner',
      role: 'runner',
      groupId: 'g1',
      athleteStatus: 'active',
      // The server's own copy of "may this account be inside the app". An active
      // row is in, whatever `approved` says — see lib/auth/membership.ts.
      membership: 'active',
      isStaff: false,
      // Migration 084: privilege now comes off the row, not only off the address.
      // A plain runner is neither, and this stays an exact-shape assertion so a
      // future field can't appear on the session unnoticed.
      isSuperUser: false,
      canApprove: false,
      // Migration 091: הגרעין is a flag too, and a plain runner is not in it.
      isCoreRunner: false,
    });
    // No coaches fallback when an athlete row was found.
    expect(reads.map(r => r.table)).toEqual(['athletes']);
  });

  it('resolves a duplicated email instead of 403-ing the athlete out of the app', async () => {
    athleteRows = [athlete({ id: 'newer' }), athlete({ id: 'older' })];
    const result = await requireSession(request('dupe'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.athleteId).toBe('newer');
  });

  it('prefers the active duplicate over an inactive one, whatever the order', async () => {
    athleteRows = [athlete({ id: 'stale', status: 'invited' }), athlete({ id: 'live', status: 'active' })];
    const result = await requireSession(request('mixed'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.athleteId).toBe('live');
  });

  it('falls back to the newest row when none is active', async () => {
    athleteRows = [athlete({ id: 'newest', status: 'invited' }), athlete({ id: 'old', status: 'inactive' })];
    const result = await requireSession(request('none-active'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.athleteId).toBe('newest');
    expect(result.user.athleteStatus).toBe('invited');
    // The row carries no `approved`, and membershipFor reads an absent flag as
    // 'inactive' rather than 'pending': the answer that promises nothing. It is
    // still NOT turned away — an 'invited' row that was never refused approval is
    // somebody mid-onboarding, and 2 of the club's rows look exactly like this.
    expect(result.user.membership).toBe('inactive');
  });

  it('403s a resolved-but-unapproved session on a gated route, and not on the waiting screen', async () => {
    // The gate the app never had: approval was a client `useEffect` that redirected
    // to /pending-approval and admitted in its own comment that it fails open, so a
    // stranger's Strava sign-in could read the feed with a plain fetch.
    athleteRows = [athlete({ id: 'newcomer', status: 'invited', approved: false })];
    const gated = await requireSession(request('newcomer', '/api/feed'));
    expect(gated.ok).toBe(false);
    if (gated.ok) return;
    expect(gated.status).toBe(403);
    expect(gated.error).toBe('pending-approval');

    // Same token, same cached resolution, exempt path — the decision is per-request
    // because the cache is keyed on the token, not the path.
    const open = await requireSession(request('newcomer', OPEN));
    expect(open.ok).toBe(true);
    expect(reads.filter(r => r.table === 'athletes')).toHaveLength(1);
  });

  it('says account-inactive, not pending-approval, for revoked access', async () => {
    // Different sentence on the waiting screen: nothing is coming for this one.
    athleteRows = [athlete({ status: 'inactive', approved: true })];
    const result = await requireSession(request('revoked'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('account-inactive');
  });

  it('reads athletes newest-first so "the newest row" is well defined', async () => {
    await requireSession(request('ordered'));
    expect(reads[0].calls).toContain('order("created_at",{"ascending":false})');
  });

  it('still recognises a legacy staff account that only exists in coaches', async () => {
    athleteRows = [];
    coachRows = [{ id: 'c1', name: 'Coach', role: 'coach' }];
    const result = await requireSession(request('legacy'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.isStaff).toBe(true);
    expect(result.user.athleteId).toBeNull();
    expect(reads.map(r => r.table)).toEqual(['athletes', 'coaches']);
  });

  it('resolves a duplicated coach email too', async () => {
    athleteRows = [];
    coachRows = [{ id: 'c1', name: 'Coach', role: 'admin' }, { id: 'c2', name: 'Coach', role: 'coach' }];
    const result = await requireSession(request('dupe-coach'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.role).toBe('admin');
  });

  it('marks academy_coach as staff', async () => {
    athleteRows = [athlete({ role: 'academy_coach' })];
    const result = await requireSession(request('academy'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.isStaff).toBe(true);
  });

  it('403s an account with no membership anywhere', async () => {
    athleteRows = [];
    const result = await requireSession(request('nobody'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it('401s without a bearer token, without touching the database', async () => {
    const result = await requireSession(new Request('https://madregot.app/api/feed'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(reads).toHaveLength(0);
  });

  it('memoises a verified session, so a page bursting requests resolves it once', async () => {
    const req = () => request('burst');
    await Promise.all([requireSession(req()), requireSession(req()), requireSession(req())]);
    expect(reads.filter(r => r.table === 'athletes')).toHaveLength(1);
  });
});
