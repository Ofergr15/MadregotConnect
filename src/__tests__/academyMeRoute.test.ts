import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessWorkout, buildPlannedWorkout, DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import type { ParsedWorkout } from '@/lib/ai/types';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';

/**
 * GET /api/academy/me — the trainee's academy home.
 *
 * The pure decisions are pinned in academyTraineeHome.test.ts. This file is about
 * what only the route can get wrong: that a club runner who is not in the academy
 * gets nothing, that nobody else's numbers are in the payload any more (the
 * leaderboard and the rank went), and that the server-only plan detail and the
 * laps are reduced to the row's few fields before they leave.
 */

const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id) }));

const computeAcademyWeekAdherence = vi.fn();
const computeAthleteWeekHistory = vi.fn();
vi.mock('@/lib/academy/report', async () => {
  const utils = await import('@/lib/utils');
  return {
    computeAcademyWeekAdherence: (o: unknown) => computeAcademyWeekAdherence(o),
    computeAthleteWeekHistory: (o: unknown) => computeAthleteWeekHistory(o),
    sundayOf: (d?: string | null) => utils.planWeekStartOf(d),
  };
});
vi.mock('@/lib/academy/settings-server', () => ({
  loadAcademySettings: async () => ({ tolerances: { ...DEFAULT_TOLERANCES, hrBpm: 5 } }),
}));
const unread = vi.fn(async () => 2);
vi.mock('@/lib/academy/thread-server', () => ({ traineeUnreadCount: () => unread() }));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({}) }));

const tables: Record<string, unknown[]> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      const result = () => ({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null });
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === undefined || r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
        gte: () => q, lte: () => q, order: () => q, limit: () => q, range: () => q,
        maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve(result()).then(ok, bad),
      };
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/academy/me/route');
const get = () => GET(new Request('http://x/api/academy/me?athleteId=a1'));

const WEEK = planWeekStartOf();
const TODAY = israelToday();
const INTERVALS: ParsedWorkout = {
  dayOfWeek: 0, name: 'אינטרוולים',
  steps: [
    { order: 0, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 340 },
    { order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 6, repeatSteps: [
      { order: 0, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 250 },
    ] },
    { order: 2, type: 'cooldown', durationType: 'distance', durationValue: 1500, targetType: 'pace', targetPaceMinPerKm: 350 },
  ],
};

beforeEach(() => {
  requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId: 'a1' } });
  tables.athletes = [
    { id: 'a1', name: 'Noa Barak', avatar_url: null, is_academy: true, academy_coach_id: 'c1', academy_band_id: null, academy_pace_offset_sec: null, academy_joined_on: null, garmin_auth: { t: 1 } },
    { id: 'c1', name: 'Dana Levi', avatar_url: null },
  ];
  tables.academy_workout_feedback = [{ athlete_id: 'a1', workout_date: TODAY }];
  tables.athlete_activities = [{ distance: 8000 }, { distance: 21300 }];
  tables.academy_candidates = [];
  tables.academy_tests = [];
  const planned = buildPlannedWorkout(INTERVALS, TODAY);
  computeAcademyWeekAdherence.mockResolvedValue({
    weekStart: WEEK, weekEnd: addDaysToDateStr(WEEK, 6), tolerances: DEFAULT_TOLERANCES,
    athletes: [{ athleteId: 'a1', name: 'Noa', week: {
      plannedCount: 1, completedCount: 0, completionRate: 0, avgScore: 0,
      workouts: [{ ...assessWorkout(planned, null), execution: null, workPace: null,
        detail: { workout: INTERVALS, laps: [{ distance: 1, duration: 1 }], verdict: null, efforts: null } }],
    } }],
  });
  computeAthleteWeekHistory.mockResolvedValue([
    { weekStart: addDaysToDateStr(WEEK, -7), plannedCount: 4, completedCount: 4, plannedM: 40000, ranM: 41000 },
    { weekStart: WEEK, plannedCount: 1, completedCount: 0, plannedM: 11600, ranM: 0 },
  ]);
});

describe('who gets a home', () => {
  it('a club runner outside the academy gets "not a member" and nothing else', async () => {
    (tables.athletes[0] as any).is_academy = false;
    const body = await (await get()).json();
    expect(body).toEqual({ isMember: false, weekStart: WEEK });
  });

  it('the self-or-staff gate decides first', async () => {
    requireCallerForAthlete.mockResolvedValue({ denied: new Response('{}', { status: 403 }), caller: {} });
    expect((await get()).status).toBe(403);
  });
});

describe('the home', () => {
  it('has the coach, the red dot and the week — and nobody else\'s numbers', async () => {
    const body = await (await get()).json();
    expect(body.coach).toMatchObject({ id: 'c1', name: 'Dana Levi' });
    expect(body.unread).toBe(2);
    expect(body).not.toHaveProperty('leaderboard');
    expect(body).not.toHaveProperty('rank');
    expect(body).not.toHaveProperty('academy');
  });

  it('reduces today\'s row to its fields, with the steps and the feedback chip', async () => {
    const body = await (await get()).json();
    const [row] = body.week.workouts;
    expect(row).toMatchObject({ date: TODAY, status: { kind: 'upcoming' }, hasFeedback: true });
    expect(row.steps.map((s: { kind: string }) => s.kind)).toEqual(['warmup', 'main', 'cooldown']);
    expect(row).not.toHaveProperty('detail');
    expect(JSON.stringify(body)).not.toContain('"laps"');
  });

  it('charts the weeks and fills the journey', async () => {
    const body = await (await get()).json();
    expect(body.km.weeks.map((w: { km: number }) => w.km)).toEqual([41, 0]);
    expect(body.journey).toMatchObject({ runs: 2, km: 29, longestKm: 21.3, streakWeeks: 1 });
  });

  it('grades with accuracy and keeps the plan detail server-side', async () => {
    await get();
    expect(computeAcademyWeekAdherence).toHaveBeenCalledWith({ weekStart: WEEK, onlyAthleteId: 'a1', keepDetail: true });
  });
});
