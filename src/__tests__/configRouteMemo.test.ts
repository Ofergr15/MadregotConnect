import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two config reads that every screen in the app waits for.
 *
 * `GET /api/admin/tab-permissions` is the role→tab matrix the Header and the tab
 * bar cannot render without, and `GET /api/groups` is read by half the app
 * (Header, tab bar, profile, onboarding, leaderboards). Both were measured at
 * ~390 ms warm against a dev machine — essentially all Supabase round trip and
 * no work — on content that changes monthly. Both are now memoised in process.
 *
 * What's pinned here is the pair of properties that a future edit breaks
 * silently, because nothing about either is visible to a type or a build:
 *
 *  - the second read inside the window must not reach the database at all (get
 *    the `memo.set` in the wrong place and the cache is decoration);
 *  - a write must drop it, or the admin who just toggled a checkbox in Settings
 *    watches it spring back — the single most alarming way a cache can surface.
 */

let permissionReads = 0;
let groupReads = 0;
let settingReads = 0;
let settingFails = false;

const PERMISSIONS = [{ role: 'runner', tab: 'feed', enabled: true }];
const GROUPS = [
  { id: 'g1', name: 'Group 1', pace_profile: { offsetSeconds: 0 }, created_at: '2026-01-01', athletes: [] },
];

/** A supabase-js chain that answers whatever it is asked, and counts the reads. */
function chain(result: unknown, onRead?: () => void) {
  const self = () => obj;
  const obj: Record<string, unknown> = {
    select: self,
    eq: self,
    not: self,
    update: self,
    insert: self,
    delete: self,
    single: async () => result,
    maybeSingle: async () => {
      onRead?.();
      return result;
    },
    upsert: async () => ({ error: null }),
    // `order` is reached only by the list reads, and `then` only when the chain
    // is awaited rather than terminated by single()/upsert() — which is what
    // lets each table count its own GET without counting the writes.
    order: () => {
      onRead?.();
      return obj;
    },
    then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err),
  };
  return obj;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'role_tab_permissions') {
        // Two `.order()`s per read, so count halves.
        return chain({ data: PERMISSIONS, error: null }, () => { permissionReads += 0.5; });
      }
      if (table === 'groups') {
        return chain({ data: GROUPS, error: null }, () => { groupReads += 1; });
      }
      if (table === 'app_settings') {
        const result = settingFails
          ? { data: null, error: { message: 'auth service blip' } }
          : { data: { value: JSON.stringify({ teamDays: [1, 4], workoutHour: 19 }) }, error: null };
        return chain(result, () => { settingReads += 1; });
      }
      // The two id-only connection lookups in the groups route.
      return chain({ data: [], error: null });
    },
  }),
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true,
    user: { email: 'coach@madregot.club', athleteId: 'a1', role: 'coach', isStaff: true },
  }),
  authError: () => new Response('unauthorized', { status: 401 }),
}));

vi.mock('@/lib/auth/require-approver', () => ({
  requireApprover: async () => ({ denied: null }),
}));

beforeEach(() => {
  permissionReads = 0;
  groupReads = 0;
  settingReads = 0;
  settingFails = false;
  vi.useFakeTimers();
  // Each test gets its own copy of the route module, because the memo it is
  // about lives in that module's scope.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/admin/tab-permissions — memoised', () => {
  const load = () => import('@/app/api/admin/tab-permissions/route');

  it('answers the second caller without touching the database', async () => {
    const { GET } = await load();

    const first = await (await GET()).json();
    const second = await (await GET()).json();

    expect(second).toEqual(first);
    expect(second.permissions).toEqual(PERMISSIONS);
    expect(permissionReads).toBe(1);
  });

  it('reads again once the window has passed', async () => {
    const { GET } = await load();
    await GET();
    vi.advanceTimersByTime(31_000);
    await GET();
    expect(permissionReads).toBe(2);
  });

  it('drops the memo when a staff member changes a tab', async () => {
    // The reason the TTL can be as long as it is: the one person who would ever
    // notice staleness is the admin editing the matrix, and their own write
    // invalidates it on the instance they are talking to.
    const { GET, PUT } = await load();
    await GET();
    expect(permissionReads).toBe(1);

    const res = await PUT(new Request('https://madregot.app/api/admin/tab-permissions', {
      method: 'PUT',
      body: JSON.stringify({ role: 'runner', tab: 'feed', enabled: false }),
    }));
    expect(res.status).toBe(200);

    await GET();
    expect(permissionReads).toBe(2);
  });
});

describe('GET /api/groups — memoised', () => {
  const load = () => import('@/app/api/groups/route');
  const get = (url = 'https://madregot.app/api/groups') => new Request(url);

  it('answers the second caller without touching the database', async () => {
    const { GET } = await load();

    const first = await (await GET(get())).json();
    const second = await (await GET(get())).json();

    expect(second).toEqual(first);
    expect(second.groups).toHaveLength(1);
    expect(groupReads).toBe(1);
  });

  it('never serves one coach the entry cached for another', async () => {
    // `coach_id` is caller-supplied on this route, so a single-slot memo would
    // hand whoever asked second the roster belonging to whoever asked first.
    const { GET } = await load();
    await GET(get('https://madregot.app/api/groups?coach_id=coach-a'));
    await GET(get('https://madregot.app/api/groups?coach_id=coach-b'));
    expect(groupReads).toBe(2);
  });

  it('reads again once the (short) window has passed', async () => {
    // Short precisely because a dozen other routes move an athlete between
    // groups without going through this file — see the comment there.
    const { GET } = await load();
    await GET(get());
    vi.advanceTimersByTime(11_000);
    await GET(get());
    expect(groupReads).toBe(2);
  });

  it('drops the memo when a group is created, edited or deleted', async () => {
    const body = (b: unknown) => JSON.stringify(b);
    const req = (method: string, b: unknown) =>
      new Request('https://madregot.app/api/groups', { method, body: body(b) });

    for (const invalidate of [
      async (m: Awaited<ReturnType<typeof load>>) => m.POST(req('POST', { name: 'Group 4' })),
      async (m: Awaited<ReturnType<typeof load>>) => m.PUT(req('PUT', { id: 'g1', name: 'Renamed' })),
      async (m: Awaited<ReturnType<typeof load>>) =>
        m.DELETE(new Request('https://madregot.app/api/groups?id=g1', { method: 'DELETE' })),
    ]) {
      vi.resetModules();
      groupReads = 0;
      const mod = await load();

      await mod.GET(get());
      expect(groupReads).toBe(1);
      await invalidate(mod);
      await mod.GET(get());
      expect(groupReads).toBe(2);
    }
  });
});

describe('GET /api/reminder-config — memoised', () => {
  const load = () => import('@/app/api/reminder-config/route');

  it('answers the second caller without touching the database', async () => {
    // Four components on one dashboard load read this route.
    const { GET } = await load();

    const first = await (await GET()).json();
    const second = await (await GET()).json();

    expect(second.config).toMatchObject({ teamDays: [1, 4], workoutHour: 19 });
    expect(second).toEqual(first);
    expect(settingReads).toBe(1);
  });

  it('does NOT memoise the default it falls back to when the read fails', async () => {
    // The route answers with the built-in reminder times both when the club has
    // never configured any and when the read simply failed, and only the first is
    // an answer. Memoising a blip would show the admin their own settings
    // reverting for the length of the window.
    settingFails = true;
    const { GET } = await load();

    const res = await (await GET()).json();
    expect(res.config).toMatchObject({ teamDays: [2, 5] });
    await GET();

    expect(settingReads).toBe(2);
  });

  it('drops the memo when an approver saves new reminder times', async () => {
    const { GET, PUT } = await load();
    await GET();
    expect(settingReads).toBe(1);

    const res = await PUT(new Request('https://madregot.app/api/reminder-config', {
      method: 'PUT',
      body: JSON.stringify({ config: { teamDays: [3], workoutHour: 20 } }),
    }));
    expect(res.status).toBe(200);

    await GET();
    expect(settingReads).toBe(2);
  });
});
