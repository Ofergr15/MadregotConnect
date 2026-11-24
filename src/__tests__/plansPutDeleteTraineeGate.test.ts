import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

// QA 23.11 #2: PUT/DELETE /api/plans gate a trainee's row exactly as POST does.
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: () => {} }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/week-setup/server', () => ({ logWeek: async () => {}, tellWeekAdmins: async () => {} }));
vi.mock('@/lib/plan-builder/server', () => ({ recordLegacyPlanWrite: async () => {} }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: { athleteId: 'me', role: 'academy_coach', roles: ['academy_coach'], isStaff: true, isSuperUser: false, email: 'me' } }),
}));
// 'mine' is my trainee, 'theirs' is another coach's.
vi.mock('@/lib/academy/pairing-server', () => ({
  academyTraineesNotYours: async (_c: unknown, ids: string[]) => ids.filter((id) => id === 'theirs'),
}));
const plans = await import('@/app/api/plans/route');

beforeEach(() => {
  db = createMemoryDb({
    schema: { weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status'] },
    defaults: { weekly_plans: () => ({ id: uid(), athlete_id: null }) },
  });
  for (const [id, athlete_id] of [['g', null], ['m', 'mine'], ['t', 'theirs']] as const) {
    db.tables.weekly_plans.push({ id, coach_id: COACH_ID, athlete_id, week_start_date: '2026-11-22', parsed_workouts: { workouts: [] }, status: 'draft' });
  }
});
const call = (m: 'PUT' | 'DELETE', b: object) => (plans as any)[m](new Request('http://x/api/plans', { method: m, body: JSON.stringify(b) }) as never);
const row = (id: string) => (db.tables.weekly_plans as any[]).find((r) => r.id === id);

describe('PUT /api/plans trainee gate', () => {
  it("refuses another coach's trainee and writes nothing", async () => {
    const r = await call('PUT', { plan_id: 't', status: 'published' });
    expect(r.status).toBe(403);
    expect(row('t').status).toBe('draft');
  });
  it('still updates my trainee and the group plan', async () => {
    expect((await call('PUT', { plan_id: 'm', status: 'published' })).status).toBe(200);
    expect((await call('PUT', { plan_id: 'g', status: 'published' })).status).toBe(200);
    expect([row('m').status, row('g').status]).toEqual(['published', 'published']);
  });
  it('404 for an unknown plan', async () => {
    expect((await call('PUT', { plan_id: 'nope', status: 'published' })).status).toBe(404);
  });
});

describe('DELETE /api/plans trainee gate', () => {
  it("refuses another coach's trainee and deletes nothing", async () => {
    expect((await call('DELETE', { plan_id: 't' })).status).toBe(403);
    expect(row('t')).toBeDefined();
  });
  it('still deletes my trainee and the group plan', async () => {
    expect((await call('DELETE', { plan_id: 'm' })).status).toBe(200);
    expect((await call('DELETE', { plan_id: 'g' })).status).toBe(200);
    expect(row('m')).toBeUndefined();
    expect(row('g')).toBeUndefined();
  });
});
