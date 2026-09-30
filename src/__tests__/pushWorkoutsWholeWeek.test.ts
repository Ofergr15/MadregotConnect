import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE WHOLE WEEK IN ONE REQUEST (feedback bb7fdd49), for the super user until rollout.
 *
 * The planner sent a request per pace group, an athlete at a time: about 3.5 minutes
 * for 18 athletes, and a phone that went to sleep never sent the groups after the
 * first. These drive the route with the delivery itself faked.
 */

const h = vi.hoisted(() => ({
  user: { isStaff: true, isSuperUser: true },
  live: 0,
  peak: 0,
  delivered: [] as Array<{ id: string; workouts: number; cleanDayOnce: boolean }>,
  planUpdates: [] as Array<Record<string, unknown>>,
  kept: [] as unknown[],
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: h.user }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: false }) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn() }));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (p: unknown) => { h.kept.push(p); } }));
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (a: { athlete: { id: string; name: string }; plannedWorkouts: unknown[]; cleanDayOnce?: boolean }) => {
    h.live++; h.peak = Math.max(h.peak, h.live);
    await new Promise(r => setTimeout(r, 5));
    h.live--;
    h.delivered.push({ id: a.athlete.id, workouts: a.plannedWorkouts.length, cleanDayOnce: !!a.cleanDayOnce });
    return { athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'weekly_plans') {
        return { update: (u: Record<string, unknown>) => ({ eq: async () => { h.planUpdates.push(u); return { error: null }; } }) };
      }
      const q = {
        select: () => q,
        in: (_k: string, ids: string[]) => { q.ids = ids; return q; },
        ids: [] as string[],
        eq: async () => ({ data: q.ids.map(id => ({ id, name: id })), error: null }),
      };
      return q;
    },
  }),
}));

import { POST } from '@/app/api/garmin/push-workouts/route';

const workout = (d: number) => ({ dayOfWeek: d, name: `d${d}`, steps: [] });
const call = (body: unknown) => POST(new Request('http://x/api/garmin/push-workouts', { method: 'POST', body: JSON.stringify(body) }) as never);
const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe('the whole week in one request', () => {
  beforeEach(() => {
    h.user = { isStaff: true, isSuperUser: true };
    h.live = 0; h.peak = 0; h.delivered = []; h.planUpdates = []; h.kept = [];
  });

  it('delivers every group\'s athletes their own group\'s week, a few at a time', async () => {
    const res = await call({
      planId: 'p1', weekStartDate: '2026-09-27', wholeWeek: true,
      batches: [
        { workouts: [workout(0), workout(1)], athleteIds: ids(5, 'g1-') },
        { workouts: [workout(0)], athleteIds: ids(4, 'g2-') },
      ],
    });
    const body = await res.json();
    expect(body.results).toHaveLength(9);
    expect(h.delivered.filter(d => d.id.startsWith('g1-')).every(d => d.workouts === 2)).toBe(true);
    expect(h.delivered.filter(d => d.id.startsWith('g2-')).every(d => d.workouts === 1)).toBe(true);
    expect(h.peak).toBe(3);
    expect(h.delivered.every(d => d.cleanDayOnce)).toBe(true);
  });

  it('writes the plan\'s status itself, and keeps the work alive past the phone', async () => {
    await call({ planId: 'p1', weekStartDate: '2026-09-27', wholeWeek: true, batches: [{ workouts: [workout(0)], athleteIds: ['a'] }] });
    expect(h.planUpdates).toEqual([{ status: 'pushed' }]);
    expect(h.kept).toHaveLength(1);
    await call({ planId: 'p1', weekStartDate: '2026-09-27', wholeWeek: false, batches: [{ workouts: [workout(0)], athleteIds: ['a'] }] });
    expect(h.planUpdates[1]).toEqual({ status: 'partial' });
  });

  it('is the super user\'s only: anyone else\'s push is one batch, an athlete at a time, as before', async () => {
    h.user = { isStaff: true, isSuperUser: false };
    const refused = await call({ planId: 'p1', weekStartDate: '2026-09-27', batches: [{ workouts: [workout(0)], athleteIds: ['a'] }] });
    expect(refused.status).toBe(400);
    await call({ planId: 'p1', weekStartDate: '2026-09-27', workouts: [workout(0)], athleteIds: ids(4, 'x') });
    expect(h.delivered).toHaveLength(4);
    expect(h.peak).toBe(1);
    expect(h.planUpdates).toEqual([]);
    expect(h.kept).toEqual([]);
    expect(h.delivered.every(d => !d.cleanDayOnce)).toBe(true);
  });

  it('is asked for by the planner only when the super user sends', async () => {
    const { readFileSync } = await import('fs');
    const page = readFileSync('src/app/(app)/dashboard/plan/new/page.tsx', 'utf8');
    expect(page).toMatch(/if \(superUser\) \{\s*try \{\s*await post\(\{ batches: jobs, wholeWeek: pushDays === null \}\);/);
    expect(page).toMatch(/\} else \{\s*for \(const job of jobs\) await post\(job\);/);
  });
});
