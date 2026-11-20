import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * H10.2 — negative authorization for the staff write routes a native admin area
 * will call. For each role the CURRENT code's allow/deny is asserted (see
 * docs/contracts/staff-write-authz.md for the matrix), and every denial must leave
 * the database untouched: no insert / update / upsert / delete reached Supabase.
 *
 * Auth is mocked at the session (`requireSession`); everything above it —
 * resolveVerifiedCaller, clubUpdatesCaller, requireApprover, publishGate, the
 * route's own role checks — runs for real against a recording fake client.
 */

// ── Session ─────────────────────────────────────────────────────────────────
type Sess = Record<string, unknown> | null;
let session: Sess = null;
vi.mock('@/lib/auth-session', async (orig) => {
  const real = await orig<typeof import('@/lib/auth-session')>();
  return {
    ...real,
    requireSession: async () =>
      session ? { ok: true, user: session } : { ok: false, status: 401, error: 'Missing bearer token' },
  };
});
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => ({}), maintenanceBlocks: () => false }));
vi.mock('@/lib/push', () => ({ resolveAudience: vi.fn(async () => []), sendPushLocalized: vi.fn(), notifyAthlete: vi.fn() }));

// ── Recording Supabase fake ─────────────────────────────────────────────────
const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
let writes: Array<{ table: string; op: string }> = [];
/** Row returned by maybeSingle/single per table (app_settings = club-updates config). */
let rows: Record<string, unknown> = {};
function builder(table: string) {
  const result = () => ({ data: rows[table] ?? null, error: null });
  const b: Record<string, unknown> = {};
  const self = new Proxy(b, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: [], error: null, count: 0 });
      if (prop === 'maybeSingle' || prop === 'single') return async () => result();
      return (..._args: unknown[]) => {
        if (WRITES.has(prop)) writes.push({ table, op: prop });
        return self;
      };
    },
  });
  return self;
}
const db = { from: (t: string) => builder(t), storage: { from: () => ({}) } };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

// ── Roles ───────────────────────────────────────────────────────────────────
const STAFF = ['admin', 'coach', 'academy_coach'];
type Who = 'none' | 'runner' | 'core_runner' | 'viewer' | 'coach' | 'academy_coach' | 'admin' | 'super_user' | 'approver_runner';
const ALL: Who[] = ['none', 'runner', 'core_runner', 'viewer', 'coach', 'academy_coach', 'admin', 'super_user'];
function sessionFor(who: Who): Sess {
  if (who === 'none') return null;
  const role = who === 'super_user' || who === 'approver_runner' ? 'runner' : who;
  return {
    email: `${who}@x.test`, athleteEmail: null, athleteId: `ath-${who}`, name: who,
    role, roles: [role], groupId: null, athleteStatus: 'active', membership: 'active',
    isStaff: STAFF.includes(role),
    isSuperUser: who === 'super_user',
    canApprove: who === 'super_user' || who === 'approver_runner',
    isCoreRunner: who === 'core_runner',
  };
}

const EVENT_ID = 'ev-1';
const UPDATE_ID = 'up-1';
const json = (url: string, method: string, body: unknown = {}) =>
  new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const events = await import('@/app/api/events/route');
const eventById = await import('@/app/api/events/[id]/route');
const adminUpdates = await import('@/app/api/admin/club-updates/route');
const adminSurveys = await import('@/app/api/admin/surveys/route');
const updates = await import('@/app/api/club-updates/route');
const updateById = await import('@/app/api/club-updates/[id]/route');
const react = await import('@/app/api/club-updates/[id]/react/route');

// Bodies are deliberately invalid where possible, so an ALLOWED caller stops at
// validation (400) and the matrix is about the gate, not the handler.
const CASES: Record<string, () => Promise<Response>> = {
  'POST /api/events': () => events.POST(json('/api/events', 'POST', {})),
  'PATCH /api/events/[id]': () => eventById.PATCH(json(`/api/events/${EVENT_ID}`, 'PATCH', {}), ctx(EVENT_ID)),
  'DELETE /api/events/[id]': () => eventById.DELETE(json(`/api/events/${EVENT_ID}`, 'DELETE'), ctx(EVENT_ID)),
  'PUT /api/admin/club-updates': () => adminUpdates.PUT(json('/api/admin/club-updates', 'PUT', { enabled: true })),
  'POST /api/admin/surveys': () => adminSurveys.POST(json('/api/admin/surveys', 'POST', {})),
  'POST /api/club-updates': () => updates.POST(json('/api/club-updates', 'POST', { body: '' })),
  'PATCH /api/club-updates/[id]': () => updateById.PATCH(json(`/api/club-updates/${UPDATE_ID}`, 'PATCH', { body: '' }), ctx(UPDATE_ID)),
  'DELETE /api/club-updates/[id]': () => updateById.DELETE(json(`/api/club-updates/${UPDATE_ID}`, 'DELETE'), ctx(UPDATE_ID)),
  'POST /api/club-updates/[id]/react': () => react.POST(json(`/api/club-updates/${UPDATE_ID}/react`, 'POST', { emoji: 'not-an-emoji' }), ctx(UPDATE_ID)),
};

/** Expected status per role, as the code stands. 'allow' = passes the gate (any non-401/403). */
type Exp = 401 | 403 | 'allow';
const staffOnly: Record<Who, Exp> = {
  none: 401, runner: 403, core_runner: 403, viewer: 403, coach: 'allow', academy_coach: 'allow', admin: 'allow',
  // isStaff comes from the role alone; the super-user flag on a runner row does not make it staff.
  super_user: 403, approver_runner: 403,
};
const adminOnly: Record<Who, Exp> = {
  none: 401, runner: 403, core_runner: 403, viewer: 403, coach: 403, academy_coach: 403, admin: 'allow', super_user: 'allow', approver_runner: 403,
};
const approverOnly: Record<Who, Exp> = {
  // canApprove (athletes.is_approver / APPROVER_EMAILS), not role: an admin without it is refused.
  none: 401, runner: 403, core_runner: 403, viewer: 403, coach: 403, academy_coach: 403, admin: 403, super_user: 'allow', approver_runner: 'allow',
};
// club-updates with the feature ON and nobody on the writer list: only admin/super user write.
const MATRIX: Record<string, Record<Who, Exp>> = {
  'POST /api/events': staffOnly,
  'PATCH /api/events/[id]': staffOnly,
  'DELETE /api/events/[id]': staffOnly,
  'PUT /api/admin/club-updates': adminOnly,
  'POST /api/admin/surveys': approverOnly,
  'POST /api/club-updates': adminOnly,
  'PATCH /api/club-updates/[id]': adminOnly,
  'DELETE /api/club-updates/[id]': adminOnly,
  // Any verified member may react once the feature is on (canRead).
  'POST /api/club-updates/[id]/react': {
    none: 401, runner: 'allow', core_runner: 'allow', viewer: 'allow', coach: 'allow', academy_coach: 'allow', admin: 'allow', super_user: 'allow', approver_runner: 'allow',
  },
};

const enabledCfg = (writerIds: string[] = []) => ({ value: JSON.stringify({ enabled: true, writerIds }) });

beforeEach(() => {
  writes = [];
  session = null;
  rows = {
    app_settings: enabledCfg(),
    club_updates: { id: UPDATE_ID, author_athlete_id: 'ath-someone-else', deleted_at: null, body: 'x' },
    events: null,
  };
});

describe('staff write routes — role matrix as found in code', () => {
  for (const [route, call] of Object.entries(CASES)) {
    describe(route, () => {
      for (const who of [...ALL, 'approver_runner' as Who]) {
        const exp = MATRIX[route][who];
        it(`${who} → ${exp}`, async () => {
          session = sessionFor(who);
          const res = await call();
          if (exp === 'allow') {
            expect([401, 403]).not.toContain(res.status);
          } else {
            expect(res.status).toBe(exp);
            expect(writes).toEqual([]);
          }
        });
      }
    });
  }
});

describe('club-updates — config-dependent paths', () => {
  it('feature OFF: a member cannot react, and nothing is written', async () => {
    rows.app_settings = null;
    session = sessionFor('runner');
    const res = await CASES['POST /api/club-updates/[id]/react']();
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('feature OFF: coach (staff but not admin) still cannot post', async () => {
    rows.app_settings = null;
    session = sessionFor('coach');
    expect((await CASES['POST /api/club-updates']()).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a runner on the writer list may post (policy is the writer list, not a role)', async () => {
    rows.app_settings = enabledCfg(['ath-runner']);
    session = sessionFor('runner');
    const res = await CASES['POST /api/club-updates']();
    expect([401, 403]).not.toContain(res.status);
  });

  it("a listed writer still cannot edit or delete someone else's update", async () => {
    rows.app_settings = enabledCfg(['ath-runner']);
    session = sessionFor('runner');
    expect((await CASES['PATCH /api/club-updates/[id]']()).status).toBe(403);
    expect((await CASES['DELETE /api/club-updates/[id]']()).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a writer removed from the list cannot delete their own update', async () => {
    rows.app_settings = enabledCfg([]);
    rows.club_updates = { id: UPDATE_ID, author_athlete_id: 'ath-runner', deleted_at: null, body: 'x' };
    session = sessionFor('runner');
    expect((await CASES['DELETE /api/club-updates/[id]']()).status).toBe(403);
    expect(writes).toEqual([]);
  });
});

describe('fake sanity: an allowed write does reach the recorder', () => {
  it('admin DELETE /api/events/[id] records a delete', async () => {
    session = sessionFor('admin');
    await CASES['DELETE /api/events/[id]']();
    expect(writes).toContainEqual({ table: 'events', op: 'delete' });
  });
});
