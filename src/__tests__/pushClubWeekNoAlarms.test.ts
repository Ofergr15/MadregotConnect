import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A club week goes to the watch with the three-pack text and NO pace-zone alarm,
 * even for an academy athlete. On 2026-10-11 Ofer (academy, pack ❸) ran the club's
 * Sunday with "4:35" as the 40 minutes' target — the watch's big number — and
 * "4:15 (4:25) ((4:35))" only as a note. A trainee's own week keeps its alarms.
 */

const h = vi.hoisted(() => ({ planAthlete: null as string | null, paceTargets: [] as boolean[] }));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { isStaff: true, isSuperUser: true } }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn() }));
vi.mock('@/lib/watch', () => ({ appleCandidates: async () => new Set(), deliverWeek: vi.fn(), resolveWatchProvider: () => 'garmin' }));
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (a: { athlete: { id: string; name: string }; paceTarget: boolean }) => {
    h.paceTargets.push(a.paceTarget);
    return { athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.in = () => q; q.not = () => q; q.update = () => q;
      q.insert = async () => ({ error: null });
      q.eq = () => (table === 'athletes'
        ? Promise.resolve({ data: [{ id: 'ofer', name: 'Ofer', is_academy: true, group_id: 'g3' }], error: null })
        : q);
      q.maybeSingle = async () => ({ data: table === 'weekly_plans' ? { parsed_workouts: { workouts: [] }, athlete_id: h.planAthlete } : null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
      return q;
    },
  }),
}));

import { POST } from '@/app/api/garmin/push-workouts/route';

const send = () => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({
  planId: 'p1', weekStartDate: '2026-10-11', athleteIds: ['ofer'],
  workouts: [{ dayOfWeek: 0, name: 'ראשון', steps: [] }],
}) }) as never);

describe('pace-zone alarms', () => {
  beforeEach(() => { h.paceTargets = []; });

  it("are off on the club's week, even for an academy athlete", async () => {
    h.planAthlete = null;
    await send();
    expect(h.paceTargets).toEqual([false]);
  });

  it("stay on for a trainee's own academy week", async () => {
    h.planAthlete = 'ofer';
    await send();
    expect(h.paceTargets).toEqual([true]);
  });
});
