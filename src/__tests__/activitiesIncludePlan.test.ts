import { describe, expect, it, vi } from 'vitest';

// GET /api/activities?include=plan stamps plan_matched on the rows the self-or-staff gate
// already returned, never adds a row, and leaves the field off when the read fails.
const state = vi.hoisted(() => ({ matchError: false, matchIds: ['a1'] as string[], denied: null as Response | null }));
const ROWS = [
  { id: 'a1', athlete_id: 'me', start_time: '2026-11-20', athletes: { name: 'Me' } },
  { id: 'a2', athlete_id: 'me', start_time: '2026-11-19', athletes: { name: 'Me' } },
];
function from(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'gte', 'lt', 'in', 'not', 'neq']) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(
    table === 'activity_plan_matches'
      ? (state.matchError ? { data: null, error: { message: 'x' } } : { data: state.matchIds.map((activity_id) => ({ activity_id })), error: null })
      : { data: ROWS, error: null },
  ).then(ok);
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from }) }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  requireCallerForAthlete: async () => (state.denied ? { denied: state.denied, caller: null } : { denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false } }),
}));
const { GET } = await import('@/app/api/activities/route');
const get = async (qs: string) => GET(new Request(`http://x/api/activities?${qs}`));

describe('include=plan', () => {
  it('stamps plan_matched on the returned rows only', async () => {
    state.matchError = false; state.denied = null;
    const { activities } = await (await get('athleteId=me&scope=self&include=plan')).json();
    expect(activities.map((a: { id: string; plan_matched?: boolean }) => [a.id, a.plan_matched])).toEqual([['a1', true], ['a2', false]]);
  });
  it('leaves the field off when the match read fails', async () => {
    state.matchError = true; state.denied = null;
    const { activities } = await (await get('athleteId=me&scope=self&include=plan')).json();
    expect(activities.every((a: Record<string, unknown>) => !('plan_matched' in a))).toBe(true);
  });
  it('is not stamped without include=plan', async () => {
    state.matchError = false; state.denied = null;
    const { activities } = await (await get('athleteId=me&scope=self')).json();
    expect('plan_matched' in activities[0]).toBe(false);
  });
  it('the self-or-staff gate still decides first', async () => {
    state.denied = new Response(null, { status: 403 });
    expect((await get('athleteId=other&include=plan')).status).toBe(403);
  });
});
