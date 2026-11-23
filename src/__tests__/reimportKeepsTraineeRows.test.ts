import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

// A group reimport rebuilds the CLUB's week only: academy trainees' own rows (athlete_id set)
// for that week must survive it. Before this fix the delete matched coach_id + week alone.
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/ai/parser', () => ({ parseWorkoutPlan: async () => ({ workouts: [{ dayOfWeek: 1, name: 'new', steps: [] }] }), EmptyParseError: class extends Error {} }));
vi.mock('fs', async (orig) => ({ ...(await orig<any>()), existsSync: () => true, readFileSync: () => Buffer.from('pdf') }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: { athleteId: 's', role: 'admin', isStaff: true, isSuperUser: true, email: 's' } }),
}));
const route = await import('@/app/api/plans/reimport/route');

const W = '2026-06-28';
beforeEach(() => {
  db = createMemoryDb({
    schema: { weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status', 'created_at'] },
    defaults: { weekly_plans: () => ({ id: uid(), athlete_id: null }) },
  });
  db.tables.weekly_plans.push(
    { id: 'group', coach_id: COACH_ID, athlete_id: null, week_start_date: W, parsed_workouts: { workouts: [] }, status: 'pushed' },
    { id: 'maya', coach_id: COACH_ID, athlete_id: 'maya-id', week_start_date: W, parsed_workouts: { workouts: [{ name: 'maya' }] }, status: 'pushed' },
  );
});

describe('POST /api/plans/reimport', () => {
  it('replaces the group row and leaves a trainee\'s own row for that week untouched', async () => {
    const r = await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ weekStart: W }) }));
    expect((await r.json()).results[0].status).toBe('reimported');
    const rows = db.tables.weekly_plans as any[];
    expect(rows.find((x) => x.id === 'maya')).toMatchObject({ athlete_id: 'maya-id', parsed_workouts: { workouts: [{ name: 'maya' }] } });
    // Updated in place (QA 23.11 #1): the same id, so activity_plan_matches (ON DELETE CASCADE) survive.
    expect(rows.filter((x) => !x.athlete_id)).toHaveLength(1);
    expect(rows.find((x) => x.id === 'group')).toMatchObject({ status: 'pushed', parsed_workouts: { workouts: [{ name: 'new' }] } });
  });

  it('inserts the group row when the week has none', async () => {
    db.tables.weekly_plans.splice(0, 1);
    const r = await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ weekStart: W }) }));
    expect((await r.json()).results[0].status).toBe('reimported');
    expect((db.tables.weekly_plans as any[]).filter((x) => !x.athlete_id)).toHaveLength(1);
  });
});
