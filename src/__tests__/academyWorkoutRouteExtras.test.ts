import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessWorkout, buildPlannedWorkout, DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import type { ParsedWorkout } from '@/lib/ai/types';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { laneReferences } from '@/lib/academy/senior-pick';

/**
 * GET /api/academy/workout — the trainee-experience-v2 additions beside the sheet
 * (screens 4, 5, 6): the expected ⚡ and its parts, the watch range on work steps only,
 * "why this pace", the done table, the PR null path, the watch's self-evaluation and the
 * trainee's own answer — and that the laps and the raw plan still never leave the server.
 */

const TRAINEE = uid();
const ACT = uid();
const DATE = '2026-10-13';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/academy/pairing-server', () => ({ mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id }));

const computeAcademyWeekAdherence = vi.fn();
vi.mock('@/lib/academy/report', () => ({
  computeAcademyWeekAdherence: (o: unknown) => computeAcademyWeekAdherence(o),
  sundayOf: () => '2026-10-11',
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/workout/route');
const get = () => GET(new Request(`http://x/api/academy/workout?athleteId=${TRAINEE}&date=${DATE}`));

const pace = (sec: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const WORKOUT: ParsedWorkout = {
  dayOfWeek: 2, name: '5 × 1 ק״מ',
  steps: [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, ...pace(340) },
    {
      order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5,
      repeatSteps: [
        { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(245) },
        { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
      ],
    },
    { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, ...pace(340) },
  ],
};
const LAPS = [
  ...[0, 1].map(() => ({ distance: 1000, duration: 340, averageHR: 140 })),
  ...[244, 243, 242, 241, 236].flatMap((p, i) => [{ distance: 1000, duration: p, averageHR: 168 }, ...(i < 4 ? [{ distance: 333, duration: 120, averageHR: 150 }] : [])]),
  ...[0, 1].map(() => ({ distance: 1000, duration: 330, averageHR: 142 })),
];

function report(completed: boolean) {
  const planned = buildPlannedWorkout(WORKOUT, DATE);
  const row = assessWorkout(planned, completed ? { id: ACT, date: DATE, distance: 10332, duration: 3046, averagePace: 295 } : null, DEFAULT_TOLERANCES);
  return {
    weekStart: '2026-10-11', weekEnd: '2026-10-17', tolerances: DEFAULT_TOLERANCES,
    athletes: [{
      athleteId: TRAINEE, name: 'Shahar',
      week: { plannedCount: 1, completedCount: completed ? 1 : 0, completionRate: 1, avgScore: 0, workouts: [{ ...row, execution: null, detail: { workout: WORKOUT, laps: [], verdict: null, efforts: null } }] },
    }],
  };
}

const SCHEMA: Record<string, string[]> = {
  athlete_activities: ['id', 'athlete_id', 'garmin_activity_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'perceived_feel', 'perceived_rpe', 'location_name', 'route_preview', 'source', 'strava_activity_id'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  academy_workout_feedback: ['athlete_id', 'workout_date', 'note', 'rendered', 'author_id'],
  workout_feedback: ['athlete_id', 'garmin_activity_id', 'feel', 'difficulty', 'pain'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr'],
  athletes: ['id', 'name', 'group_id'],
  groups: ['id', 'name', 'coach_id'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'created_at'],
  activity_loads: ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'],
};

const as = (extra: Record<string, unknown> = {}) =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: TRAINEE, isStaff: false, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  db = createMemoryDb({ schema: SCHEMA });
  db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-09-16', protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  db.tables.athlete_activities.push({
    id: ACT, athlete_id: TRAINEE, garmin_activity_id: 777, start_time: `${DATE}T06:30:00`, activity_type: 'running',
    distance: 10332, duration: 3046, moving_duration: 3046, average_hr: 164, max_hr: 181, laps: LAPS, splits: null,
    perceived_feel: 3, perceived_rpe: 7, location_name: 'הירקון', route_preview: null,
  });
  // The trainee's own week: its paces are theirs, as stored.
  db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: TRAINEE, week_start_date: '2026-10-11', parsed_workouts: { workouts: [WORKOUT] }, created_at: '2026-10-10' });
  computeAcademyWeekAdherence.mockResolvedValue(report(true));
  as();
});

describe('before the run (4)', () => {
  it('the expected ⚡ with parts that sum to it, the watch range on the reps only, and why 4:05', async () => {
    computeAcademyWeekAdherence.mockResolvedValue(report(false));
    const body = await (await get()).json();
    expect(body.sheet.date).toBe(DATE);
    expect(body.expectedLoad).toBeGreaterThanOrEqual(59);
    expect(body.expectedLoad).toBeLessThanOrEqual(61);
    expect(body.expectedParts.reduce((s: number, p: { load: number }) => s + p.load, 0)).toBe(body.expectedLoad);
    expect(body.steps.map((s: { watchRange: unknown }) => s.watchRange)).toEqual([null, { min: 241, max: 249 }, null]);
    expect(body.why).toEqual({ targetSec: 245, thresholdSec: 252, basisTestDate: '2026-09-16' });
    expect(body.done).toBeNull();
  });
});

describe('a club week (no plan of their own)', () => {
  it('is restated to the trainee\'s paces: the ⚡, the watch range and "why" are all theirs', async () => {
    computeAcademyWeekAdherence.mockResolvedValue(report(false));
    db.tables.weekly_plans.length = 0;
    db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: '2026-10-11', parsed_workouts: { workouts: [WORKOUT] }, created_at: '2026-10-10' });
    const body = await (await get()).json();
    const scale = 252 / laneReferences()[1];
    const reps = Math.round(245 * scale);
    expect(body.why.targetSec).toBe(reps);
    expect(body.steps[1].watchRange).toEqual({ min: Math.round(reps * 0.985), max: Math.round(reps * 1.015) });
  });
});

describe('after the run (5, 6)', () => {
  it('the done table with the ⚡ row, the watch\'s feel, and no medal without a record', async () => {
    const body = await (await get()).json();
    expect(body.done.table.map((r: { key: string }) => r.key)).toEqual(['distance', 'time', 'load']);
    const load = body.done.table.find((r: { key: string }) => r.key === 'load');
    expect(load.planned).toBe(body.expectedLoad);
    expect(load.done).toBeGreaterThan(50);
    expect(body.pr).toBeNull();
    expect(body.feelPrefill).toEqual({ feel: 3, effort: 7 });
    expect(body.feedback).toBeNull();
    expect(body.activity).toEqual({ id: ACT, garminId: 777, lapsWhy: null });
    // The run's ⚡ is stored (migration 142).
    expect(db.tables.activity_loads).toHaveLength(1);
  });

  it('the trainee\'s own answer, when there is one', async () => {
    db.tables.workout_feedback.push({ athlete_id: TRAINEE, garmin_activity_id: 777, feel: 4, difficulty: 8, pain: false });
    const body = await (await get()).json();
    expect(body.feedback).toEqual({ feel: 4, difficulty: 8, pain: false });
  });

  it('under view-as nothing is stored', async () => {
    as({ viewingAsBy: 'admin@club' });
    expect((await get()).status).toBe(200);
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
  });

  it('never sends the laps or the raw plan', async () => {
    const text = await (await get()).text();
    expect(text).not.toContain('"laps"');
    expect(text).not.toContain('"steps":[{"order"');
    expect(text).not.toContain('"repeatSteps"');
  });

  it('a broken read costs the extras, not the sheet', async () => {
    db = createMemoryDb({ schema: { athletes: ['id', 'name'] } });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).sheet.date).toBe(DATE);
  });
});
