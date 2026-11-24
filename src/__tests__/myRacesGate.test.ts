import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mayWriteRacePlan, parseRaceBody, raceSeat } from '@/lib/packs/races';
import { makeFakeDb, session, type Op } from './helpers/packsFakeDb';

/**
 * b23 own races + race plans (migration 217). Pinned: mayActFor narrowed — a coach reaches only
 * their own trainees, the manager seat everyone; the race plan is written by a coach/manager,
 * never by the athlete.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
vi.mock('@/lib/academy/trainee-coaches', async (orig) => ({
  ...(await orig<typeof import('@/lib/academy/trainee-coaches')>()),
  coachIdsOf: async (_db: unknown, athleteId: string) => (athleteId === 'trainee-1' ? ['coach-1'] : ['coach-2']),
}));
let tables: Record<string, (op: Op) => unknown[]> = {};
const writes: Op[] = [];
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => makeFakeDb(tables, writes) }));
const races = await import('@/app/api/academy/my-races/route');
const plan = await import('@/app/api/academy/race-plan/route');

const req = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { authorization: 'Bearer t' } });
const coach = session({ athleteId: 'coach-1', role: 'coach', roles: ['coach'], isStaff: true });

beforeEach(() => {
  writes.length = 0;
  tables = {
    athletes: () => [{ academy_coach_id: null, name: 'Coach' }],
    athlete_races: () => [{ id: 'r1', athlete_id: 'trainee-1', name: 'Tel Aviv', race_date: '2027-02-20', distance_m: 42195, goal_sec: null, created_by: 'trainee-1', coach_seen_at: null }],
    race_plans: () => [],
  };
});

describe('raceSeat', () => {
  const c = (athleteId: string, isStaff = false) => ({ athleteId, isStaff, isSuperUser: false });
  it('self', () => expect(raceSeat(c('a'), false, 'a', [])).toBe('self'));
  it('own coach', () => expect(raceSeat(c('coach-1', true), false, 'a', ['coach-1'])).toBe('coach'));
  it('another coach is refused', () => expect(raceSeat(c('coach-2', true), false, 'a', ['coach-1'])).toBeNull());
  it('manager seat', () => expect(raceSeat(c('m', true), true, 'a', [])).toBe('manager'));
  it('a teammate is refused', () => expect(raceSeat(c('b'), false, 'a', [])).toBeNull());
  it('only coach/manager write the plan', () => {
    expect(mayWriteRacePlan('self')).toBe(false);
    expect(mayWriteRacePlan('coach')).toBe(true);
    expect(mayWriteRacePlan('manager')).toBe(true);
  });
  it('validates bodies', () => {
    expect(parseRaceBody({ name: 'x', date: '2027-01-01', distanceM: 10000 }, false).ok).toBe(true);
    expect(parseRaceBody({ name: 'x', date: 'soon', distanceM: 10000 }, false)).toEqual({ ok: false, field: 'date' });
  });
});

describe('GET /api/academy/my-races', () => {
  it('a coach sees their own trainee', async () => {
    requireSession.mockResolvedValue(coach);
    const res = await races.GET(req('https://x.test/api/academy/my-races?athlete=trainee-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).races[0]).toEqual(expect.objectContaining({ id: 'r1', distanceM: 42195, hasPlan: false }));
  });
  it('a coach is refused for someone else\'s trainee', async () => {
    requireSession.mockResolvedValue(coach);
    const res = await races.GET(req('https://x.test/api/academy/my-races?athlete=trainee-9'));
    expect(res.status).toBe(403);
  });
  it('a runner is refused for a teammate', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'runner-1' }));
    expect((await races.GET(req('https://x.test/api/academy/my-races?athlete=trainee-1'))).status).toBe(403);
  });
});

describe('PUT /api/academy/race-plan', () => {
  const body = JSON.stringify({ goalSec: 10800, segments: [{ toM: 42195, paceSec: 255 }], fuel: [{ atM: 15000, kind: 'gel' }], note: '' });
  it('the athlete cannot write their own plan', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'trainee-1' }));
    const res = await plan.PUT(req('https://x.test/api/academy/race-plan?race=r1', { method: 'PUT', body }));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });
  it('their coach can', async () => {
    requireSession.mockResolvedValue(coach);
    const res = await plan.PUT(req('https://x.test/api/academy/race-plan?race=r1', { method: 'PUT', body }));
    expect(res.status).toBe(200);
    expect(writes.some((w) => w.table === 'race_plans')).toBe(true);
  });
});
