// POST /api/activities/{id}/lane — "I ran with pack N". Self-or-staff from the JWT;
// the athlete comes from the run's row, never the body. Synthetic rows only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const ensureMatchedWorkout = vi.fn(async () => ({ workoutKey: 'day-5-part-1-single' }) as unknown);
vi.mock('@/lib/plans/matched-workout', () => ({ ensureMatchedWorkout: (...a: unknown[]) => ensureMatchedWorkout(...(a as [])) }));
let updateResult: { data: unknown; error: unknown } = { data: [{ activity_id: 'x' }], error: null };
const updates: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { athlete_id: 'owner' }, error: null }),
        update: (v: unknown) => { updates.push(v); const u: any = { eq: () => u, select: async () => updateResult }; return u; },
      };
      return q;
    },
  }),
}));
const { POST } = await import('@/app/api/activities/[id]/lane/route');
const ID = '00000000-0000-4000-8000-000000000001';
const call = (body: unknown) => POST(new Request(`http://x/api/activities/${ID}/lane`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { isSuperUser: false, isStaff: false, athleteId: null, ...c } });

beforeEach(() => { updates.length = 0; updateResult = { data: [{ activity_id: ID }], error: null }; ensureMatchedWorkout.mockClear(); });

describe('ran-with-pack override', () => {
  it('unsigned: 401, nothing written', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await call({ lane: 3 })).status).toBe(401);
    expect(updates).toEqual([]);
  });
  it('a teammate: 404, nothing written', async () => {
    as({ athleteId: 'someone-else' });
    expect((await call({ lane: 3 })).status).toBe(404);
    expect(updates).toEqual([]);
  });
  it('the runner sets their pack', async () => {
    as({ athleteId: 'owner' });
    const res = await call({ lane: 3 });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ ran_lane: 3, resolved_lane: 3, lane_source: 'manual' }]);
  });
  it('staff may set it; null clears it', async () => {
    as({ athleteId: 'coach', isStaff: true });
    expect((await call({ lane: null })).status).toBe(200);
    expect(updates).toEqual([{ ran_lane: null, resolved_lane: null, lane_source: null }]);
  });
  it('a bad lane is a 400', async () => {
    as({ athleteId: 'owner' });
    expect((await call({ lane: 4 })).status).toBe(400);
    expect((await call({ lane: '3' })).status).toBe(400);
  });
  it('no planned workout: 409', async () => {
    as({ athleteId: 'owner' });
    ensureMatchedWorkout.mockResolvedValueOnce(null);
    expect((await call({ lane: 3 })).status).toBe(409);
  });
  it('migration 221 unapplied: 503', async () => {
    as({ athleteId: 'owner' });
    updateResult = { data: null, error: { code: '42703', message: 'column "ran_lane" does not exist' } };
    expect((await call({ lane: 3 })).status).toBe(503);
  });
});
