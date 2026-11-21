// Hardening proposal (2026-11-21): GET /api/activities/[id]/plan-match was unauthenticated and
// returned a completion % computed against the athlete's OWN plan. Now self-or-staff, by
// omission ({ matched: false }) for a signed-in member who may not read it, 401 unsigned.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const planTargetForDate = vi.fn(async () => ({ min: 10, max: 10, type: 'easy' }));
vi.mock('@/lib/post-workout', () => ({ planTargetForDate: (...a: unknown[]) => planTargetForDate(...(a as [])) }));
// Synthetic rows only. `row` is what the activity read returns for the id asked.
let row: { data: unknown; error: unknown } = { data: { start_time: '2026-11-17T06:30:00Z', distance: 10200, athlete_id: 'owner' }, error: null };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => row }; return q; } }),
}));
const { GET } = await import('@/app/api/activities/[id]/plan-match/route');
const call = () => GET(new Request('http://x/api/activities/act-1/plan-match'), { params: Promise.resolve({ id: 'act-1' }) });
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { isSuperUser: false, isStaff: false, athleteId: null, ...c } });

beforeEach(() => { planTargetForDate.mockClear(); row = { data: { start_time: '2026-11-17T06:30:00Z', distance: 10200, athlete_id: 'owner' }, error: null }; });

describe('plan-match gate', () => {
  it('unsigned caller: 401, nothing read', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await call()).status).toBe(401);
    expect(planTargetForDate).not.toHaveBeenCalled();
  });
  it("a teammate: { matched: false }, and the owner's plan is never read", async () => {
    as({ athleteId: 'someone-else' });
    expect(await (await call()).json()).toEqual({ matched: false });
    expect(planTargetForDate).not.toHaveBeenCalled();
  });
  it('the owner gets the match', async () => {
    as({ athleteId: 'owner' });
    expect(await (await call()).json()).toMatchObject({ matched: true, pct: 102, actualKm: 10.2, targetKm: 10 });
  });
  // Staff = STAFF_ROLES (admin, coach, academy_coach) via resolveVerifiedCaller's isStaff, plus the
  // super user: exactly mayActFor, the helper the verdict route uses. No member-wide access.
  it.each([
    ['admin', { athleteId: 'a-admin', isStaff: true, role: 'admin' }],
    ['coach', { athleteId: 'a-coach', isStaff: true, role: 'coach' }],
    ['academy_coach', { athleteId: 'a-ac', isStaff: true, role: 'academy_coach' }],
    ['super user (owner)', { athleteId: 'a-owner-acct', isSuperUser: true }],
  ])('staff role %s gets the match', async (_n, c) => {
    as(c);
    expect(await (await call()).json()).toMatchObject({ matched: true });
  });
  it.each([['runner'], ['core_runner'], ['viewer']])('a signed-in %s who is not the owner gets { matched: false }', async (role) => {
    as({ athleteId: 'someone-else', role });
    expect(await (await call()).json()).toEqual({ matched: false });
    expect(planTargetForDate).not.toHaveBeenCalled();
  });
  it('a signed-in caller with no athlete row gets { matched: false }', async () => {
    as({ athleteId: null });
    expect(await (await call()).json()).toEqual({ matched: false });
  });
  it('missing activity: { matched: false } for anyone signed in — no existence oracle', async () => {
    row = { data: null, error: null };
    as({ athleteId: 'owner' });
    expect(await (await call()).json()).toEqual({ matched: false });
    as({ athleteId: 'someone-else' });
    expect(await (await call()).json()).toEqual({ matched: false });
  });
  it('invalid id / DB error: { matched: false }, nothing leaked, unsigned still 401 first', async () => {
    row = { data: null, error: { message: 'invalid input syntax for type uuid' } };
    as({ athleteId: 'owner' });
    expect(await (await call()).json()).toEqual({ matched: false });
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await call()).status).toBe(401);
  });
  it('an activity with no athlete_id is never scored', async () => {
    row = { data: { start_time: '2026-11-17T06:30:00Z', distance: 10200, athlete_id: null }, error: null };
    as({ athleteId: 'coach', isStaff: true });
    expect(await (await call()).json()).toEqual({ matched: false });
  });
  it('the client sends the session', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/activities-client.ts'), 'utf8');
    expect(src).toMatch(/plan-match`, \{ headers: await apiHeaders\(\) \}/);
  });
});

describe('plan-match responses are never cacheable', () => {
  const noStore = (r: Response) => expect(r.headers.get('cache-control')).toBe('private, no-store');
  it('401', async () => { resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} }); noStore(await call()); });
  it('{ matched: false } for a non-owner', async () => { as({ athleteId: 'someone-else' }); noStore(await call()); });
  it('the match itself', async () => { as({ athleteId: 'owner' }); noStore(await call()); });
  it('missing activity', async () => { row = { data: null, error: null }; as({ athleteId: 'owner' }); noStore(await call()); });
  it('DB error', async () => { row = { data: null, error: { message: 'x' } }; as({ athleteId: 'owner' }); noStore(await call()); });
});
