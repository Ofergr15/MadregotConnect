import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessWorkout, buildPlannedWorkout, DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * GET /api/academy/workout — one workout, planned vs actual.
 *
 * What only the route can get wrong: WHO may read a grade (the trainee, their own
 * coach, the manager — `mayCoach`, not any staff), which day it answers for, and
 * that the stored laps and the raw plan never leave the server.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));

const mayCoach = vi.fn();
vi.mock('@/lib/academy/pairing-server', () => ({ mayCoach: (c: unknown, id: string) => mayCoach(c, id) }));

const computeAcademyWeekAdherence = vi.fn();
vi.mock('@/lib/academy/report', () => ({
  computeAcademyWeekAdherence: (o: unknown) => computeAcademyWeekAdherence(o),
  sundayOf: (d: string) => (d >= '2026-10-04' ? '2026-10-04' : '2026-09-27'),
}));

const tables: Record<string, Record<string, unknown> | null> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      };
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/academy/workout/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/workout?${q}`));

const WORKOUT: ParsedWorkout = {
  dayOfWeek: 1, name: 'ריצה קלה 10 ק״מ',
  steps: [{ order: 0, type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: 340 }],
};

function weekWith(date: string) {
  const planned = buildPlannedWorkout(WORKOUT, date);
  const row = assessWorkout(planned, { id: 'act-9', date, distance: 6200, duration: 2223, averagePace: 358 }, DEFAULT_TOLERANCES);
  return {
    weekStart: '2026-10-04', weekEnd: '2026-10-10', tolerances: DEFAULT_TOLERANCES,
    athletes: [{
      athleteId: 'a1', name: 'Noa',
      week: {
        plannedCount: 1, completedCount: 1, completionRate: 1, avgScore: 0, workouts: [{
          ...row, execution: null,
          detail: { workout: WORKOUT, laps: [{ distance: 1000, duration: 345, averagePace: 345 }], verdict: null, efforts: null },
        }],
      },
    }],
  };
}

beforeEach(() => {
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'a1', isStaff: false, isSuperUser: false, role: 'runner' } });
  mayCoach.mockResolvedValue(true);
  computeAcademyWeekAdherence.mockResolvedValue(weekWith('2026-10-05'));
  tables.athlete_activities = { id: 'act-9', start_time: '2026-10-05T19:40:00', location_name: 'הירקון', route_preview: null };
  tables.academy_workout_feedback = { note: 'למה נעצרת?', rendered: '', author_id: 'coach-1' };
  tables.athletes = { name: 'Dana Levi' };
});

describe('the request', () => {
  it('needs an athlete and a calendar day', async () => {
    expect((await get('athleteId=a1')).status).toBe(400);
    expect((await get('athleteId=a1&date=5.10')).status).toBe(400);
  });

  it('refuses anyone the 1:1 line does not allow — asked of mayCoach, about this athlete', async () => {
    mayCoach.mockResolvedValue(false);
    const res = await get('athleteId=a2&date=2026-10-05');
    expect(res.status).toBe(403);
    expect(mayCoach.mock.calls[0][1]).toBe('a2');
    expect(computeAcademyWeekAdherence).not.toHaveBeenCalled();
  });

  it('passes an unauthenticated caller\'s denial straight through', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await get('athleteId=a1&date=2026-10-05')).status).toBe(401);
  });

  it('is a 404 on a day with nothing planned', async () => {
    expect((await get('athleteId=a1&date=2026-10-07')).status).toBe(404);
  });
});

describe('the answer', () => {
  it('grades the plan week the day falls in, for that athlete only, with the detail kept', async () => {
    await get('athleteId=a1&date=2026-10-05');
    expect(computeAcademyWeekAdherence).toHaveBeenCalledWith({ weekStart: '2026-10-04', onlyAthleteId: 'a1', keepDetail: true });
  });

  it('is the sheet, with the coach\'s note and the run\'s own clock', async () => {
    const body = await (await get('athleteId=a1&date=2026-10-05')).json();
    expect(body.sheet).toMatchObject({
      date: '2026-10-05', name: 'ריצה קלה 10 ק״מ', activityId: 'act-9', startClock: '19:40', locationName: 'הירקון',
      status: { kind: 'partial', pct: 62 },
      feedback: { text: 'למה נעצרת?', mentorName: 'Dana Levi' },
    });
  });

  it('never sends the laps or the raw plan', async () => {
    const text = await (await get('athleteId=a1&date=2026-10-05')).text();
    expect(text).not.toContain('"laps"');
    expect(text).not.toContain('"steps":[{"order"');
    expect(text).not.toContain('"detail"');
  });
});
