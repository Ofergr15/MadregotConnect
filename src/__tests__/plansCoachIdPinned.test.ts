import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

// POST /api/plans must not write a plan under a caller-chosen coach_id.
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: () => {} }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/week-setup/server', () => ({ logWeek: async () => {}, tellWeekAdmins: async () => {} }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: { athleteId: 'staff', role: 'coach', roles: ['coach'], isStaff: true, isSuperUser: false, email: 's' } }),
}));
const plans = await import('@/app/api/plans/route');

beforeEach(() => {
  db = createMemoryDb({
    schema: { weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status'] },
    defaults: { weekly_plans: () => ({ id: uid() }) },
  });
});
const save = (coach_id: string) => plans.POST(new Request('http://x/api/plans', {
  method: 'POST', body: JSON.stringify({ coach_id, week_start_date: '2026-11-22', parsed_workouts: { workouts: [] }, original_input: '' }),
}) as never);

describe('POST /api/plans coach_id', () => {
  it('refuses a coach_id other than the club COACH_ID, and writes nothing', async () => {
    const r = await save(uid());
    expect(r.status).toBe(400);
    expect(db.tables.weekly_plans).toHaveLength(0);
  });
  it('still saves under COACH_ID', async () => {
    const r = await save(COACH_ID);
    expect(r.status).toBeLessThan(300);
    expect(db.tables.weekly_plans[0]?.coach_id).toBe(COACH_ID);
  });
});
