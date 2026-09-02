import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

/**
 * These routes used to take the caller's identity from `x-user-email` — a header
 * the caller writes themselves. Sending a coach's address was enough to read any
 * athlete's PRs, badges, volume, GPS traces and Garmin data, and to be handed
 * `role: 'admin'` by /api/auth/me. They now resolve identity from the Supabase
 * session instead.
 *
 * Two kinds of test here, because the interesting failure is a silent
 * regression: a source-level guard that the header can't creep back into these
 * files, and behavioural tests for the two routes whose contract actually
 * changed shape (auth/me and activities).
 */

const SRC = new URL('../', import.meta.url);

const MIGRATED_ROUTES = [
  'app/api/athletes/prs/route.ts',
  'app/api/athletes/heatmap/route.ts',
  'app/api/athletes/volume-history/route.ts',
  'app/api/athletes/badges/route.ts',
  'app/api/athletes/summary/route.ts',
  'app/api/challenges/route.ts',
  'app/api/activities/route.ts',
  'app/api/activities/details/route.ts',
  'app/api/garmin/activity-details/route.ts',
  'app/api/auth/me/route.ts',
];

// Most of these files still discuss the old header in a comment explaining what
// changed, so the guard has to match the READ, not the string.
const READS_EMAIL_HEADER = /headers\s*\.\s*get\(\s*['"]x-user-email['"]/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

describe('verified identity on every API route', () => {
  // Proves the guard below can actually fail — it's asserting the ABSENCE of a
  // pattern, which a typo'd regex would satisfy for every file forever.
  it('recognises the header read it is guarding against', () => {
    expect(`const email = (request.headers.get('x-user-email') || '').toLowerCase();`)
      .toMatch(READS_EMAIL_HEADER);
    expect(`const email = request.headers.get("x-user-email");`).toMatch(READS_EMAIL_HEADER);
    // ...and isn't just matching the words wherever they appear.
    expect(`// identity used to come from x-user-email`).not.toMatch(READS_EMAIL_HEADER);
  });

  // Not just the ten routes this change touched: with those migrated, NO route
  // takes identity from the header any more, so the whole directory is the
  // invariant worth holding. A new route copy-pasting the old block fails here.
  it('no route resolves the caller from a client-supplied header', () => {
    const root = fileURLToPath(new URL('app/api', SRC));
    const offenders = routeFiles(root).filter((f) => READS_EMAIL_HEADER.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each(MIGRATED_ROUTES)('%s gates on a verified session', (route) => {
    const source = readFileSync(new URL(route, SRC), 'utf8');
    expect(source).toMatch(/resolveVerifiedCaller|requireCallerForAthlete|requireSession/);
  });

  // The client half: sending the header is what made forging it the obvious
  // attack, and a route that starts reading it again would find it there.
  it('the shared client helpers no longer send the header', () => {
    expect(readFileSync(new URL('lib/api.ts', SRC), 'utf8')).not.toMatch(/['"]x-user-email['"]\s*:/);
  });
});

// ---------------------------------------------------------------------------

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (result: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: result.error }), { status: result.status }),
}));

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const session = (over: Partial<{ email: string; athleteId: string | null; role: string; isStaff: boolean }> = {}) => ({
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

// Records every filter the route applies, so "did it scope the query to this
// athlete" is checkable without a database.
type Op = { table: string; op: string; patch?: Record<string, unknown>; filters: Array<[string, unknown[]]> };
let ops: Op[] = [];
let rows: unknown[] = [];
let selected: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, op: 'select', filters: [] };
      ops.push(record);
      const track = (fn: string) => (...args: unknown[]) => {
        record.filters.push([fn, args]);
        return chain;
      };
      const chain: Record<string, unknown> = {
        select: track('select'),
        update: (patch: Record<string, unknown>) => {
          record.op = 'update';
          record.patch = patch;
          return chain;
        },
        order: track('order'),
        limit: track('limit'),
        eq: track('eq'),
        in: track('in'),
        maybeSingle: () => Promise.resolve({ data: selected, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { GET: me } = await import('@/app/api/auth/me/route');
const { GET: activities } = await import('@/app/api/activities/route');

beforeEach(() => {
  requireSession.mockReset();
  ops = [];
  rows = [];
  selected = null;
});

describe('GET /api/auth/me', () => {
  it('401s without a usable session instead of trusting an address', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await me(new Request('https://example.test/api/auth/me'));
    expect(res.status).toBe(401);
  });

  // The one non-obvious case: requireSession treats "verified but not a member"
  // as a 403, while for this route that's a legitimate answer — it's the
  // 'viewer' the old code fell through to, and the nav needs A role to render.
  it('answers viewer for a verified account with no membership', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 403, error: 'No membership found for this account' });
    const res = await me(new Request('https://example.test/api/auth/me'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'viewer' });
  });

  it('returns the session role plus the academy flag, and stamps last_seen_at by id', async () => {
    requireSession.mockResolvedValue(session({ role: 'coach', isStaff: true }));
    selected = { is_academy: true };
    const res = await me(new Request('https://example.test/api/auth/me'));
    expect(await res.json()).toEqual({ role: 'coach', isAcademy: true });

    const update = ops.find((o) => o.op === 'update');
    expect(update?.table).toBe('athletes');
    expect(Object.keys(update?.patch || {})).toEqual(['last_seen_at']);
    // By athlete id, never by the email the caller supplied.
    expect(update?.filters).toEqual([['eq', ['id', ME]]]);
  });

  it('serves a legacy coaches-only account, which has no athletes row to read', async () => {
    requireSession.mockResolvedValue(session({ athleteId: null, role: 'coach', isStaff: true }));
    const res = await me(new Request('https://example.test/api/auth/me'));
    expect(await res.json()).toEqual({ role: 'coach' });
    // Nothing to select or stamp — and stamping by a null id would touch rows.
    expect(ops).toHaveLength(0);
  });

  // A missing is_academy column must not cost someone their nav.
  it('reports isAcademy false when the flag can not be read', async () => {
    requireSession.mockResolvedValue(session());
    selected = null;
    const res = await me(new Request('https://example.test/api/auth/me'));
    expect(await res.json()).toEqual({ role: 'runner', isAcademy: false });
  });
});

describe('GET /api/activities', () => {
  const get = (qs = '') => activities(new Request(`https://example.test/api/activities${qs}`));

  it('refuses a runner asking for somebody else, which used to just work', async () => {
    requireSession.mockResolvedValue(session());
    const res = await get(`?athleteId=${OTHER}`);
    expect(res.status).toBe(403);
    // The point: no query ran at all, so nothing leaked on the way to the 403.
    expect(ops).toHaveLength(0);
  });

  it('scopes a runner asking for themselves to their own rows', async () => {
    requireSession.mockResolvedValue(session());
    rows = [{ id: 'a1', athlete_id: ME, athletes: { name: 'Runner' } }];
    const res = await get(`?athleteId=${ME}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activities: [{ id: 'a1', athlete_id: ME, athlete_name: 'Runner' }] });
    expect(ops[0].filters).toContainEqual(['eq', ['athlete_id', ME]]);
  });

  // Omitting the id means "the whole club", so it can't be open to a runner.
  it('refuses a runner who omits the id', async () => {
    requireSession.mockResolvedValue(session());
    const res = await get();
    expect(res.status).toBe(403);
    expect(ops).toHaveLength(0);
  });

  it('lets staff omit the id for the club-wide list', async () => {
    requireSession.mockResolvedValue(session({ role: 'coach', isStaff: true }));
    rows = [{ id: 'a1', athlete_id: OTHER, athletes: { name: 'Someone' } }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(ops[0].filters.some(([fn, args]) => fn === 'eq' && args[0] === 'athlete_id')).toBe(false);
  });

  it('401s an anonymous caller rather than answering for an athlete id', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const res = await get(`?athleteId=${ME}`);
    expect(res.status).toBe(401);
    expect(ops).toHaveLength(0);
  });
});
