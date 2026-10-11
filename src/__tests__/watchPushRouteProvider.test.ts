import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The coach push routes each athlete by provider: Garmin athletes exactly as
 * before (pushWeekToAthlete, same arguments), an Apple athlete to the queue.
 */

const h = vi.hoisted(() => ({
  garmin: [] as Array<Record<string, unknown>>,
  apple: [] as Array<Record<string, unknown>>,
  athletes: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { isStaff: true, isSuperUser: false } }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn() }));
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (a: any) => {
    h.garmin.push(a);
    return { athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success' };
  },
}));
vi.mock('@/lib/watch', async (orig) => ({
  ...(await orig<object>()),
  appleCandidates: async () => new Set(['apple-1']),
  deliverWeek: async (provider: string, a: any) => {
    h.apple.push({ provider, ...a });
    return { athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success', provider, queued: true };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = { select: () => q, in: () => q, eq: async () => ({ data: h.athletes, error: null }) };
      return q;
    },
  }),
}));

import { POST } from '@/app/api/garmin/push-workouts/route';

beforeEach(() => {
  h.garmin = []; h.apple = [];
  h.athletes = [
    { id: 'garmin-1', name: 'G', garmin_auth: { tokens: 1 }, is_academy: true },
    { id: 'apple-1', name: 'A', garmin_auth: null, is_academy: true },
    { id: 'none-1', name: 'N', garmin_auth: null, is_academy: false },
  ];
});

describe('coach push by provider', () => {
  it('Garmin and no-watch athletes take the old path; the Apple athlete is queued', async () => {
    const res = await POST(new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ planId: 'p', weekStartDate: '2026-10-04', workouts: [{ dayOfWeek: 0, name: 'x', steps: [] }], athleteIds: ['garmin-1', 'apple-1', 'none-1'] }),
    }) as never);
    const body = await res.json();
    expect(body.results.map((r: any) => r.athleteId)).toEqual(['garmin-1', 'apple-1', 'none-1']);
    expect(h.garmin.map((a: any) => a.athlete.id)).toEqual(['garmin-1', 'none-1']);
    expect(h.apple.map((a: any) => [a.provider, a.athlete.id, a.paceTarget])).toEqual([['apple', 'apple-1', true]]);
    // The Garmin call is the same call as before the refactor, plus `notify`
    // (the sheet's "notify athletes" switch), which is on unless the body says off.
    expect(Object.keys(h.garmin[0]).sort()).toEqual(['athlete', 'cleanDayOnce', 'notify', 'paceTarget', 'planId', 'plannedWorkouts', 'pushCopy', 'supabase', 'weekStartDate']);
    expect(h.garmin.every((a: any) => a.notify === true)).toBe(true);
  });

  it('a quiet send (notifyAthletes: false) tells no athlete', async () => {
    h.garmin.length = 0;
    await POST(new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ planId: 'p', weekStartDate: '2026-10-04', notifyAthletes: false, workouts: [{ dayOfWeek: 0, name: 'x', steps: [] }], athleteIds: ['garmin-1'] }),
    }) as never);
    expect(h.garmin.map((a: any) => a.notify)).toEqual([false]);
  });
});
