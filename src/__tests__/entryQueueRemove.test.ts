import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * POST /api/admin/entry-queue/remove — taking somebody out of the club, and
 * putting them back.
 *
 * Four rules, and each of them is here because getting it wrong is expensive:
 *
 *  1. **It writes `status` and nothing else.** 25 tables cascade off
 *     `athletes(id)`, so a delete would take a member's runs, PRs, badges and
 *     attendance with it, irreversibly. Nothing in this route may delete a row.
 *  2. **Admin only**, unlike every other action on the entry queue. A coach who
 *     may approve and nudge may not end a membership.
 *  3. **Nobody removes an admin, and nobody removes themselves.** Locking
 *     yourself out of the screen that grants access needs somebody else, or SQL.
 *  4. **The maintenance exemption goes with them.** Leaving their handle on the
 *     allowlist means the next window quietly holds the door open for somebody
 *     who is no longer in the club.
 */

let athlete: Record<string, unknown> | null;
let isSuperUser: boolean;
let role: string;
let isStaff: boolean;
let callerAthleteId: string;
let allow: string[];
/** Every write the route made, so "soft" is provable rather than asserted. */
let updates: Array<Record<string, unknown>>;
let upserts: Array<unknown>;
let deletes: number;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'app_settings') {
        return { upsert: async (rows: unknown) => { upserts.push(rows); return { error: null }; } };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: athlete, error: null }) }) }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => { updates.push(values); return { error: null }; },
        }),
        delete: () => { deletes += 1; return { eq: async () => ({ error: null }) }; },
      };
    },
  }),
}));

vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaffCaller: async () => (isStaff
    ? {
        denied: null,
        caller: {
          email: 'strava_1@strava.madregot.local',
          athleteId: callerAthleteId,
          isSuperUser,
          role,
          isStaff: true,
          canApprove: true,
        },
      }
    : { denied: new Response('forbidden', { status: 403 }), caller: null }),
}));

vi.mock('@/lib/maintenance', () => ({
  readMaintenance: async () => ({ on: true, allow }),
  clearMaintenanceCache: () => {},
}));

const { POST } = await import('@/app/api/admin/entry-queue/remove/route');

const call = (body: Record<string, unknown>) =>
  POST(new Request('https://madregot.app/api/admin/entry-queue/remove', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never);

beforeEach(() => {
  athlete = { id: 'dana-1', name: 'דנה', email: 'dana@example.com', role: 'runner', status: 'active', is_super_user: false };
  isSuperUser = true;
  role = 'runner';
  isStaff = true;
  callerAthleteId = 'admin-1';
  allow = ['dana@example.com', 'someone-else@example.com'];
  updates = [];
  upserts = [];
  deletes = 0;
});

describe('POST /api/admin/entry-queue/remove', () => {
  it('writes a status and never deletes anything', async () => {
    const res = await call({ athleteId: 'dana-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, removed: true });
    expect(updates).toEqual([{ status: 'removed' }]);
    expect(deletes).toBe(0);
  });

  it('takes their maintenance exemption off the allowlist with them', async () => {
    await call({ athleteId: 'dana-1' });
    expect(upserts).toEqual([[{ key: 'maintenance_allow', value: 'someone-else@example.com' }]]);
  });

  it('leaves the allowlist alone when they were never on it', async () => {
    allow = ['someone-else@example.com'];
    const res = await call({ athleteId: 'dana-1' });
    expect(await res.json()).toMatchObject({ allowlistTrimmed: false });
    expect(upserts).toEqual([]);
  });

  it('restores by writing active — and leaves the allowlist untouched', async () => {
    athlete = { ...athlete, status: 'removed' };
    const res = await call({ athleteId: 'dana-1', action: 'restore' });
    expect(await res.json()).toMatchObject({ ok: true, removed: false });
    expect(updates).toEqual([{ status: 'active' }]);
    expect(upserts).toEqual([]);
  });

  it('refuses a coach who may approve but is not an admin', async () => {
    isSuperUser = false;
    role = 'coach';
    const res = await call({ athleteId: 'dana-1' });
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it('accepts the club owner, whose row is role runner with the super-user flag', async () => {
    // Gating on role alone would lock out the one person this button is for.
    isSuperUser = true;
    role = 'runner';
    expect((await call({ athleteId: 'dana-1' })).status).toBe(200);
  });

  it('refuses to remove an admin, or the caller themselves', async () => {
    athlete = { ...athlete, role: 'admin' };
    expect((await call({ athleteId: 'dana-1' })).status).toBe(400);

    athlete = { ...athlete, role: 'runner', is_super_user: true };
    expect((await call({ athleteId: 'dana-1' })).status).toBe(400);

    athlete = { id: 'admin-1', name: 'me', email: 'me@example.com', role: 'runner', status: 'active', is_super_user: false };
    expect((await call({ athleteId: 'admin-1' })).status).toBe(400);

    expect(updates).toEqual([]);
  });

  it('404s an unknown athlete and 400s a request with no id', async () => {
    athlete = null;
    expect((await call({ athleteId: 'ghost' })).status).toBe(404);
    expect((await call({})).status).toBe(400);
    expect(updates).toEqual([]);
  });

  it('refuses a non-staff caller before reading anything', async () => {
    isStaff = false;
    expect((await call({ athleteId: 'dana-1' })).status).toBe(403);
    expect(updates).toEqual([]);
  });
});
