// Task 75: GET /api/plans/[planId]/matches read the club's week of runs in one
// request, which Supabase caps at 1000 rows — ordered by start_time, so it was the
// end of the week (Thu–Sat) that silently vanished on a busy week.
import { describe, expect, it, vi } from 'vitest';

const RUNS = Array.from({ length: 1500 }, (_, i) => ({
  id: `act-${String(i).padStart(5, '0')}`,
  athlete_id: `a${i % 60}`,
  // Spread over the week, reverse of id order, so a sort is needed.
  start_time: `2026-11-${String(22 + Math.floor((1499 - i) / 250)).padStart(2, '0')}T06:${String((1499 - i) % 60).padStart(2, '0')}:00`,
  activity_name: 'run', distance: 10000, average_pace: 300, average_hr: 150,
}));

function builder(table: string) {
  let lo = 0; let hi = Infinity;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, eq: self, or: self, gte: self, lt: self, in: self, order: self,
    range: (a: number, b: number) => { lo = a; hi = b; return chain; },
    maybeSingle: async () => ({ data: { id: 'p1', week_start_date: '2026-11-22', parsed_workouts: { workouts: [] }, status: 'pushed' }, error: null }),
    then: (res: (v: unknown) => unknown) => {
      if (table === 'athlete_activities') {
        // Supabase's cap: never more than 1000 rows per request.
        const end = Math.min(hi, lo + 999);
        return Promise.resolve({ data: RUNS.slice(lo, end + 1), error: null }).then(res);
      }
      return Promise.resolve({ data: [], error: null }).then(res);
    },
  });
  return chain;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: builder }) }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async () => ({ ok: true as const, user: { email: 'c@x', athleteId: 'c', role: 'coach', isStaff: true, isSuperUser: false, canApprove: false } }),
}));

describe('plan matches: the whole week, past 1000 runs, in time order', () => {
  it('returns all 1500 runs sorted by start_time', async () => {
    const { GET } = await import('@/app/api/plans/[planId]/matches/route');
    const res = await GET(new Request('http://x/api/plans/p1/matches'), { params: Promise.resolve({ planId: 'p1' }) });
    expect(res.status).toBe(200);
    const { activities } = await res.json() as { activities: Array<{ start_time: string }> };
    expect(activities).toHaveLength(1500);
    const times = activities.map((a) => a.start_time);
    expect(times).toEqual([...times].sort());
    expect(times[times.length - 1] >= '2026-11-27').toBe(true);
  });
});
