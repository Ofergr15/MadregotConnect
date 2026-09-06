import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The club-wide aggregates had no auth at all. Between them they served the
 * whole active roster by name with each person's weekly distance/streak
 * (leaderboard), the roster plus anyone's follow graph (discover), a name
 * lookup over the roster (search), the sponsor discount codes (perks), the
 * coach's plan (weekly), squad training rollups (standings), and athlete names
 * with their join state (stats) — to anyone who knew the URL.
 *
 * Two of them were the same forgeable-identity bug as the x-user-email sweep in
 * a different costume: `perks` and `search` decided the premium `core_runner`
 * perk tier by looking up the role of an athleteId the CALLER put in the query
 * string, and `discover` took its viewer the same way. Those get behavioural
 * coverage below, because a gate alone wouldn't have fixed them.
 */

const SRC = new URL('../', import.meta.url);

const GATED_ROUTES = [
  'app/api/perks/route.ts',
  'app/api/search/route.ts',
  'app/api/athletes/discover/route.ts',
  'app/api/groups/leaderboard/route.ts',
  'app/api/groups/standings/route.ts',
  'app/api/dashboard/weekly/route.ts',
  'app/api/dashboard/stats/route.ts',
];

const GATE = /requireMember|requireStaff|resolveVerifiedCaller/;

describe('club aggregates resolve a caller before answering', () => {
  // The absence-style guard further down can't fail if the pattern is wrong, so
  // pin the pattern to samples first.
  it('recognises a gate and does not match an ungated handler', () => {
    expect(`const denied = await requireMember(request);`).toMatch(GATE);
    expect(`const { denied, caller } = await resolveVerifiedCaller(request);`).toMatch(GATE);
    expect(`export async function GET() {\n  const supabase = createServerClient();`).not.toMatch(GATE);
  });

  it.each(GATED_ROUTES)('%s gates on a verified session', (route) => {
    expect(readFileSync(new URL(route, SRC), 'utf8')).toMatch(GATE);
  });

  // The whole point of moving the tier/viewer decision to the session: there is
  // nothing left for a caller to assert about who they are.
  it.each([
    ['app/api/perks/route.ts', /searchParams\.get\(\s*['"]athleteId['"]/],
    ['app/api/search/route.ts', /searchParams\.get\(\s*['"]athleteId['"]/],
    ['app/api/athletes/discover/route.ts', /searchParams\.get\(\s*['"]viewerId['"]/],
  ])('%s no longer reads identity out of the query string', (route, pattern) => {
    expect(readFileSync(new URL(route, SRC), 'utf8')).not.toMatch(pattern as RegExp);
  });
});

// ---------------------------------------------------------------------------

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  // Only requireSession is mocked — the gates themselves (requireMember,
  // requireStaff, resolveVerifiedCaller in src/lib/auth/self-or-staff.ts) run
  // for real on top of it, so this covers the actual authorization logic.
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const session = (over: Partial<{ athleteId: string | null; role: string; isStaff: boolean; isCoreRunner: boolean }> = {}) => ({
  ok: true as const,
  user: {
    email: 'runner@madregot.local',
    athleteId: ME,
    name: 'Runner',
    role: 'runner',
    groupId: null,
    athleteStatus: 'active',
    isStaff: false,
    ...over,
  },
});

const NO_SESSION = { ok: false, status: 401, error: 'Missing bearer token' };

/** Every chained call a route makes, per `from()`, so filters are assertable. */
type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];
let tableRows: Record<string, unknown[]> = {};

/**
 * A Proxy stands in for the query builder so this mock doesn't need editing
 * every time a route reaches for another operator (.or, .ilike, .gte, .returns…).
 * Any method records itself and returns the chain; awaiting resolves to the rows
 * registered for that table.
 */
function chainFor(record: Op) {
  const result = () => ({ data: tableRows[record.table] ?? [], error: null });
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          const rows = tableRows[record.table] ?? [];
          return () => Promise.resolve({ data: rows[0] ?? null, error: null });
        }
        return (...args: unknown[]) => {
          record.calls.push([prop as string, args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, calls: [] };
      ops.push(record);
      return chainFor(record);
    },
  }),
}));

const { GET: perks } = await import('@/app/api/perks/route');
const { GET: search } = await import('@/app/api/search/route');
const { GET: discover } = await import('@/app/api/athletes/discover/route');
const { GET: leaderboard } = await import('@/app/api/groups/leaderboard/route');
const { GET: standings } = await import('@/app/api/groups/standings/route');
const { GET: weekly } = await import('@/app/api/dashboard/weekly/route');
const { GET: stats } = await import('@/app/api/dashboard/stats/route');

const ROUTES: Array<[string, (req: Request) => Promise<Response>, string]> = [
  ['perks', perks, '/api/perks'],
  ['search', search, '/api/search?q=dan'],
  ['discover', discover, '/api/athletes/discover'],
  ['leaderboard', leaderboard, '/api/groups/leaderboard'],
  ['standings', standings, '/api/groups/standings'],
  ['weekly', weekly, '/api/dashboard/weekly'],
  ['stats', stats, '/api/dashboard/stats'],
];

const call = (fn: (req: Request) => Promise<Response>, path: string) =>
  fn(new Request(`https://example.test${path}`));

beforeEach(() => {
  requireSession.mockReset();
  ops = [];
  tableRows = {};
});

describe('anonymous callers', () => {
  it.each(ROUTES)('%s answers 401 and runs no query', async (_name, fn, path) => {
    requireSession.mockResolvedValue(NO_SESSION);
    const res = await call(fn, path);
    expect(res.status).toBe(401);
    // Nothing may leak on the way to the refusal.
    expect(ops).toHaveLength(0);
  });

  // search used to return an empty 200 for a short query before touching auth;
  // the gate has to come first or "is this address a member" stays answerable.
  it('search refuses before the min-length shortcut', async () => {
    requireSession.mockResolvedValue(NO_SESSION);
    const res = await call(search, '/api/search?q=a');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/perks', () => {
  it('shows a plain runner the base tier only', async () => {
    requireSession.mockResolvedValue(session());
    await call(perks, '/api/perks');
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).toContainEqual(['eq', ['tier', 'all']]);
  });

  it('unlocks the premium tier for a core_runner', async () => {
    requireSession.mockResolvedValue(session({ role: 'core_runner' }));
    await call(perks, '/api/perks');
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).not.toContainEqual(['eq', ['tier', 'all']]);
  });

  // ── THE FLAG PATH (migration 091) ────────────────────────────────────────
  // The gate that actually decides whether the 6 core-squad partnerships are
  // returned at all. Worth pinning in both directions: the perks are real money
  // (a free annual gym membership, a shoe allocation), so a leak hands them to
  // the whole club and a false negative takes them off the people who have them.
  it('unlocks the core tier for a flagged member whose role is plain runner', async () => {
    // The case the role comparison could never express, and the case Ofer is in.
    requireSession.mockResolvedValue(session({ role: 'runner', isCoreRunner: true }));
    await call(perks, '/api/perks');
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).not.toContainEqual(['eq', ['tier', 'all']]);
  });

  it('unlocks it for a coach in the squad without touching their role', async () => {
    requireSession.mockResolvedValue(session({ role: 'coach', isStaff: true, isCoreRunner: true }));
    await call(perks, '/api/perks');
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).not.toContainEqual(['eq', ['tier', 'all']]);
  });

  it('keeps the core tier away from a member who is not in the squad', async () => {
    // Explicit false, not merely absent — this is the 25 other athletes.
    requireSession.mockResolvedValue(session({ role: 'runner', isCoreRunner: false }));
    await call(perks, '/api/perks');
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).toContainEqual(['eq', ['tier', 'all']]);
  });

  it('filters the core tier in search too, for the same caller', async () => {
    // Search reads club_perks with its own copy of the gate, so it can drift.
    requireSession.mockResolvedValue(session({ role: 'runner', isCoreRunner: false }));
    await call(search, '/api/search?q=hoka');
    expect(ops.find((o) => o.table === 'club_perks')?.calls).toContainEqual(['eq', ['tier', 'all']]);
    ops = [];
    requireSession.mockResolvedValue(session({ role: 'runner', isCoreRunner: true }));
    await call(search, '/api/search?q=hoka');
    expect(ops.find((o) => o.table === 'club_perks')?.calls).not.toContainEqual(['eq', ['tier', 'all']]);
  });

  // The bug this replaces: any core_runner's id in the URL bought the premium
  // tier, and the ids are on the leaderboard.
  it('ignores an athleteId in the URL, and never looks a role up by it', async () => {
    requireSession.mockResolvedValue(session());
    await call(perks, `/api/perks?athleteId=${OTHER}`);
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).toContainEqual(['eq', ['tier', 'all']]);
    expect(ops.map((o) => o.table)).not.toContain('athletes');
  });
});

describe('GET /api/search', () => {
  it('searches for a member of the club', async () => {
    requireSession.mockResolvedValue(session());
    const res = await call(search, '/api/search?q=dan');
    expect(res.status).toBe(200);
    expect(ops.map((o) => o.table)).toContain('athletes');
  });

  it('applies the caller’s own perk tier, not one named in the URL', async () => {
    requireSession.mockResolvedValue(session());
    await call(search, `/api/search?q=dan&athleteId=${OTHER}`);
    const club = ops.find((o) => o.table === 'club_perks');
    expect(club?.calls).toContainEqual(['eq', ['tier', 'all']]);
  });
});

describe('GET /api/athletes/discover', () => {
  it('reads the follow graph of the session, not of ?viewerId', async () => {
    requireSession.mockResolvedValue(session());
    const res = await call(discover, `/api/athletes/discover?viewerId=${OTHER}`);
    expect(res.status).toBe(200);
    const follows = ops.find((o) => o.table === 'athlete_follows');
    expect(follows?.calls).toContainEqual(['eq', ['follower_id', ME]]);
    expect(follows?.calls).not.toContainEqual(['eq', ['follower_id', OTHER]]);
  });

  it('excludes the viewer from their own discover list', async () => {
    requireSession.mockResolvedValue(session());
    tableRows.athletes = [
      { id: ME, name: 'Me', avatar_url: null, group_id: null, status: 'active' },
      { id: OTHER, name: 'Them', avatar_url: null, group_id: null, status: 'active' },
    ];
    const res = await call(discover, '/api/athletes/discover');
    const { athletes } = (await res.json()) as { athletes: Array<{ id: string }> };
    expect(athletes.map((a) => a.id)).toEqual([OTHER]);
  });

  // A legacy coaches-only account has no athletes row, so there's no follow
  // graph to read — and no query may be built with a null follower_id.
  it('returns an empty list for a staff account with no athlete row', async () => {
    requireSession.mockResolvedValue(session({ athleteId: null, role: 'coach', isStaff: true }));
    const res = await call(discover, '/api/athletes/discover');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ athletes: [] });
    expect(ops).toHaveLength(0);
  });
});

describe('GET /api/dashboard/stats', () => {
  it('refuses a runner — it carries athlete names and join state', async () => {
    requireSession.mockResolvedValue(session());
    const res = await call(stats, '/api/dashboard/stats');
    expect(res.status).toBe(403);
    expect(ops).toHaveLength(0);
  });

  it('serves staff', async () => {
    requireSession.mockResolvedValue(session({ role: 'coach', isStaff: true }));
    const res = await call(stats, '/api/dashboard/stats');
    expect(res.status).toBe(200);
  });
});

// Gating a `revalidate`-exporting route makes Next throw DynamicServerError
// during the build to bail out of static prerendering, and these three routes
// wrap everything in a catch that would report it as a 500.
describe('rethrowIfDynamicBailout', () => {
  it('rethrows Next’s bailout and swallows nothing else', async () => {
    const { rethrowIfDynamicBailout } = await import('@/lib/dynamic-bailout');
    const bailout = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
    expect(() => rethrowIfDynamicBailout(bailout)).toThrow(bailout);
    // A real failure must still fall through to the route's own 500 handling.
    expect(() => rethrowIfDynamicBailout(new Error('db down'))).not.toThrow();
    expect(() => rethrowIfDynamicBailout(Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT' }))).not.toThrow();
    expect(() => rethrowIfDynamicBailout(null)).not.toThrow();
  });

  it.each([
    'app/api/groups/leaderboard/route.ts',
    'app/api/groups/standings/route.ts',
    'app/api/dashboard/weekly/route.ts',
  ])('%s calls it before logging', (route) => {
    const source = readFileSync(new URL(route, SRC), 'utf8');
    expect(source).toMatch(/rethrowIfDynamicBailout\(error\);\s*\n\s*console\.error/);
  });
});

describe('the member-gated club views serve any member', () => {
  it.each([
    ['leaderboard', leaderboard, '/api/groups/leaderboard'],
    ['standings', standings, '/api/groups/standings'],
    ['weekly', weekly, '/api/dashboard/weekly'],
  ] as Array<[string, (req: Request) => Promise<Response>, string]>)(
    '%s answers a plain runner',
    async (_name, fn, path) => {
      requireSession.mockResolvedValue(session());
      const res = await call(fn, path);
      expect(res.status).toBe(200);
    },
  );
});
