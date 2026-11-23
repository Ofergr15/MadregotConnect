import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/me/watch/resend — a runner re-sends their OWN day to their own watch.
const state = vi.hoisted(() => ({
  caller: 'me' as string,
  flag: true,
  athletes: {} as Record<string, any>,
  plans: [] as any[],
  pushes: [] as any[],
}));

vi.mock('@/lib/auth-session', () => ({
  requireAthlete: async () => ({ ok: true, user: { athleteId: state.caller } }),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/features/server', () => ({
  isFeatureEnabled: async (k: string) => k === 'native_resend_workout' && state.flag,
}));
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (args: any) => { state.pushes.push(args); return { status: 'success' }; },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      const rows = () => {
        if (table === 'athletes') return Object.values(state.athletes).filter((a) => a.id === f.id);
        if (table === 'groups') return [{ id: 'g1', pace_profile: { marathonGoal: '3:00' } }];
        return state.plans.filter((p) => p.week_start_date === f.week_start_date
          && ('athlete_id' in f ? (p.athlete_id ?? null) === f.athlete_id : true));
      };
      const c: any = {
        select: () => c, order: () => c, limit: () => c,
        eq: (k: string, v: unknown) => { if (k !== 'coach_id') f[k] = v; return c; },
        is: (k: string, v: unknown) => { f[k] = v; return c; },
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (res: any) => res({ data: rows() }),
      };
      return c;
    },
  }),
}));

import { POST } from '@/app/api/me/watch/resend/route';

const wk = (dayOfWeek: number, name: string) => ({ dayOfWeek, name, steps: [] });
// 2026-11-22 is a Sunday → plan week 2026-11-22; Tuesday 2026-11-24 = dayOfWeek 2.
const WEEK = '2026-11-22';
const req = (body: unknown) => new Request('http://x/api/me/watch/resend', { method: 'POST', body: JSON.stringify(body) });

let n = 0;
beforeEach(() => {
  state.caller = `me${++n}`; // fresh rate-limit key per test
  state.flag = true;
  state.pushes = [];
  state.athletes = {
    [state.caller]: { id: state.caller, name: 'Me', garmin_auth: { enc: 'SECRET' }, is_academy: false, group_id: 'g1' },
    other: { id: 'other', name: 'Other', garmin_auth: { enc: 'X' }, is_academy: false, group_id: 'g1' },
  };
  state.plans = [{ id: 'club', week_start_date: WEEK, athlete_id: null, status: 'pushed',
    parsed_workouts: { workouts: [wk(2, 'club tue'), wk(4, 'club thu')] } }];
});

describe('POST /api/me/watch/resend', () => {
  it('404s while native_resend_workout is off', async () => {
    state.flag = false;
    expect((await POST(req({ date: '2026-11-24' }))).status).toBe(404);
    expect(state.pushes).toHaveLength(0);
  });

  it('sends only the caller\'s workout for that day, never the token', async () => {
    const res = await POST(req({ date: '2026-11-24' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, sent: 1, date: '2026-11-24' });
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(state.pushes).toHaveLength(1);
    expect(state.pushes[0].athlete.id).toBe(state.caller);
    expect(state.pushes[0].plannedWorkouts.map((w: any) => w.name)).toEqual(['club tue']);
    expect(state.pushes[0].paceTarget).toBe(false);
  });

  it('ignores an athleteId in the body', async () => {
    const res = await POST(req({ date: '2026-11-24', athleteId: 'other', athlete_id: 'other' }));
    expect(res.status).toBe(200);
    expect(state.pushes[0].athlete.id).toBe(state.caller);
  });

  it('409 when Garmin is not connected', async () => {
    state.athletes[state.caller].garmin_auth = null;
    expect((await POST(req({ date: '2026-11-24' }))).status).toBe(409);
    expect(state.pushes).toHaveLength(0);
  });

  it('404 when there is no planned workout that day', async () => {
    expect((await POST(req({ date: '2026-11-23' }))).status).toBe(404); // Monday: nothing planned
    expect((await POST(req({ date: '2026-12-01' }))).status).toBe(404); // a week with no plan
    expect(state.pushes).toHaveLength(0);
  });

  it('prefers a trainee\'s individual academy week over the group plan, with pace targets', async () => {
    state.athletes[state.caller].is_academy = true;
    state.plans.push({ id: 'mine', week_start_date: WEEK, athlete_id: state.caller, status: 'pushed',
      parsed_workouts: { workouts: [wk(2, 'academy tue')] } });
    const res = await POST(req({ date: '2026-11-24' }));
    expect(res.status).toBe(200);
    expect(state.pushes[0].planId).toBe('mine');
    expect(state.pushes[0].plannedWorkouts.map((w: any) => w.name)).toEqual(['academy tue']);
    expect(state.pushes[0].paceTarget).toBe(true);
  });

  it('rejects a malformed date', async () => {
    expect((await POST(req({ date: '24/11/2026' }))).status).toBe(400);
  });

  it('rate-limits at 5 per hour per athlete', async () => {
    for (let i = 0; i < 5; i++) expect((await POST(req({ date: '2026-11-24' }))).status).toBe(200);
    expect((await POST(req({ date: '2026-11-24' }))).status).toBe(429);
    expect(state.pushes).toHaveLength(5);
  });
});
