import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/groups memoises its body for 10s per coach, and the body depends on the
 * caller (emails are staff-only). The memo used to hold whichever caller came first:
 * staff then runner served the runner every member's email.
 */

const h = vi.hoisted(() => ({ isStaff: true }));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { isStaff: h.isStaff, isSuperUser: false } }),
  authError: () => new Response(null, { status: 401 }),
}));

const GROUPS = [{ id: 'g1', name: 'Group 1', pace_profile: null, created_at: '2026-01-01', athletes: [{ id: 'a1', name: 'Dana', email: 'dana@example.com', status: 'active', data_source: 'garmin' }] }];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.not = () => Promise.resolve({ data: [], error: null });
      q.order = () => Promise.resolve({ data: table === 'groups' ? GROUPS : [], error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
  }),
}));

const emails = async (coach: string) => {
  const { GET } = await import('@/app/api/groups/route');
  const res = await GET(new Request(`http://x/api/groups?coach_id=${coach}`));
  const body = await res.json();
  return body.groups.flatMap((g: { athletes: Array<{ email: string | null }> }) => g.athletes.map((a) => a.email));
};

describe('groups list cache', () => {
  beforeEach(() => { h.isStaff = true; });

  it("a runner right after staff does not get the staff response's emails", async () => {
    h.isStaff = true;
    expect(await emails('c-staff-first')).toEqual(['dana@example.com']);
    h.isStaff = false;
    expect(await emails('c-staff-first')).toEqual([null]);
  });

  it('staff right after a runner still get the emails', async () => {
    h.isStaff = false;
    expect(await emails('c-runner-first')).toEqual([null]);
    h.isStaff = true;
    expect(await emails('c-runner-first')).toEqual(['dana@example.com']);
  });
});
