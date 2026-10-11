import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A re-push from the history screen (byAthleteGroup) gives each athlete their OWN
 * pack's copy of the saved plan. It used to send group1's copy to everyone, so a
 * pack-❸ runner went out with pack ❶'s paces as their targets.
 */

const h = vi.hoisted(() => ({ delivered: [] as Array<{ id: string; pace: number | undefined }> }));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { isStaff: true, isSuperUser: false } }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: false }) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn() }));
vi.mock('@/lib/watch', () => ({ appleCandidates: async () => new Set(), deliverWeek: vi.fn(), resolveWatchProvider: () => 'garmin' }));
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (a: { athlete: { id: string; name: string }; plannedWorkouts: Array<{ steps: Array<{ targetPaceMinPerKm?: number }> }> }) => {
    h.delivered.push({ id: a.athlete.id, pace: a.plannedWorkouts[0]?.steps[0]?.targetPaceMinPerKm });
    return { athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success' };
  },
}));

const run = (pace: number) => ({ dayOfWeek: 0, name: 'ראשון', steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace }] });
const PLAN = { group1: { workouts: [run(255)] }, group2: { workouts: [run(265)] }, group3: { workouts: [run(275)] } };
// Faster marathon goal → group1. g-fast is pack ❶, g-slow is pack ❸.
const GROUPS = [{ id: 'g-fast', pace_profile: { marathonGoal: 10_800 } }, { id: 'g-mid', pace_profile: { marathonGoal: 12_600 } }, { id: 'g-slow', pace_profile: { marathonGoal: 14_400 } }];
const ATHLETES = [{ id: 'fast', name: 'fast', group_id: 'g-fast' }, { id: 'slow', name: 'slow', group_id: 'g-slow' }];

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.in = () => q;
      q.not = () => q;
      q.update = () => q;
      q.insert = async () => ({ error: null });
      q.eq = () => {
        if (table === 'athletes') return Promise.resolve({ data: ATHLETES, error: null });
        if (table === 'groups') return Promise.resolve({ data: GROUPS, error: null });
        return q;
      };
      q.maybeSingle = async () => ({ data: table === 'weekly_plans' ? { parsed_workouts: PLAN } : null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
      return q;
    },
  }),
}));

import { POST } from '@/app/api/garmin/push-workouts/route';

const call = (body: unknown) => POST(new Request('http://x/api/garmin/push-workouts', { method: 'POST', body: JSON.stringify(body) }) as never);

describe('history re-push', () => {
  beforeEach(() => { h.delivered = []; });

  it("sends each athlete their own pack's copy", async () => {
    await call({ planId: 'p1', weekStartDate: '2026-10-11', workouts: PLAN.group1.workouts, athleteIds: ['fast', 'slow'], byAthleteGroup: true });
    expect(h.delivered.sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: 'fast', pace: 255 }, { id: 'slow', pace: 275 }]);
  });

  it('without the flag, sends what the caller sent, as before', async () => {
    await call({ planId: 'p1', weekStartDate: '2026-10-11', workouts: PLAN.group1.workouts, athleteIds: ['fast', 'slow'] });
    expect(h.delivered.map((d) => d.pace)).toEqual([255, 255]);
  });
});
