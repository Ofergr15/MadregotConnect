import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * requireSession resolving a Strava login whose athlete row carries a REAL email.
 *
 * Strava sends no address, so a Strava sign-in is a Supabase user whose email is
 * `strava_<id>@strava.madregot.local` — one the app invented. The athlete row is
 * keyed on the member's own email as soon as anybody corrects it, which is a thing
 * the club wants (an unreachable address is why approval mail bounces). The moment
 * that happened, requireSession — which matched on the email and nothing else —
 * found no row, fell through to `coaches`, and returned 403. Every route in the app
 * answered 403 at once, and the shell told a fully active, approved member "this
 * account is not connected to a membership", with no way back in, because a Strava
 * sign-in is the only door there is.
 *
 * Hit in production on 2026-09-07 by Ofer's own account.
 */

let athleteRows: Array<Record<string, unknown>>;
let getUserEmail: string | null;
/** Every read that reached the database, with the filters it applied. */
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
      const track = (fn: string) => (...args: unknown[]) => {
        record.calls.push(`${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        return chain;
      };
      const chain: Record<string, unknown> = {
        select: track('select'),
        eq: track('eq'),
        or: track('or'),
        order: track('order'),
        limit: track('limit'),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === 'coaches' ? [] : athleteRows, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { requireSession, clearSessionCache } = await import('@/lib/auth-session');

const STRAVA_ID = 106828158;
const SYNTHETIC = `strava_${STRAVA_ID}@strava.madregot.local`;

function request(seed: string): Request {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return new Request('https://madregot.app/api/feed', {
    headers: { authorization: `Bearer header.${payload}.sig-${seed}` },
  });
}

/** What the filters of the athletes read looked like. */
const athleteFilters = () => reads.find((r) => r.table === 'athletes')?.calls.join(' ') || '';

beforeEach(() => {
  clearSessionCache();
  reads = [];
  athleteRows = [];
  getUserEmail = SYNTHETIC;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

describe('requireSession — a Strava login whose row has a real email', () => {
  it('resolves the member by their Strava athlete id', async () => {
    athleteRows = [{
      id: 'ofer', name: 'Ofer Grosfeld', email: 'grosfeldofer@gmail.com',
      role: 'admin', group_id: null, status: 'active', strava_athlete_id: STRAVA_ID,
    }];

    const result = await requireSession(request('a'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.athleteId).toBe('ofer');
    expect(result.user.role).toBe('admin');
    expect(result.user.athleteStatus).toBe('active');
  });

  it('asks the database for the Strava id, not only the synthetic address', async () => {
    await requireSession(request('b'));
    expect(athleteFilters()).toContain(`strava_athlete_id.eq.${STRAVA_ID}`);
    expect(athleteFilters()).toContain(`email.eq.${SYNTHETIC}`);
  });

  it('prefers the row carrying the Strava id over one that merely holds the address', async () => {
    // Both rows come back from the same `or`. The synthetic-address row is by
    // construction the emptier duplicate; signing in as it would hand an admin a
    // runner's account.
    athleteRows = [
      { id: 'dupe', name: 'Ofer', email: SYNTHETIC, role: 'runner', group_id: null, status: 'active', strava_athlete_id: null },
      { id: 'ofer', name: 'Ofer Grosfeld', email: 'grosfeldofer@gmail.com', role: 'admin', group_id: null, status: 'active', strava_athlete_id: STRAVA_ID },
    ];

    const result = await requireSession(request('c'));
    expect(result.ok && result.user.athleteId).toBe('ofer');
  });

  it('still 403s a Strava login that matches nobody', async () => {
    // The fix must not invent a membership — an unknown Strava account is exactly
    // the stranger the approval gate exists to hold outside.
    const result = await requireSession(request('d'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it('leaves an ordinary email login matching on the email alone', async () => {
    // A real address must not start matching rows for a reason it never used to.
    getUserEmail = 'coach@madregot.club';
    athleteRows = [{ id: 'c1', name: 'Coach', email: 'coach@madregot.club', role: 'coach', group_id: null, status: 'active' }];

    const result = await requireSession(request('e'));
    expect(result.ok && result.user.athleteId).toBe('c1');
    expect(athleteFilters()).toContain('eq("email","coach@madregot.club")');
    expect(athleteFilters()).not.toContain('or(');
  });
});
