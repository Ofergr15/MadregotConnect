import { describe, expect, it } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { assessWorkout, buildPlannedWorkout, type AdherenceTolerances } from '@/lib/academy/adherence';
import { effortReportFor, segmentReportFor } from '@/lib/plan-execution/resolve';
import { buildVerdict } from '@/lib/plan-execution/verdict';
import type { WorkoutAdherenceRow } from '@/lib/academy/report';
import type { Lap } from '@/lib/academy/segments';
import { buildWorkoutSheet, lengthHe } from '@/lib/academy/workout-sheet';

/**
 * The plan-vs-actual sheet, built through the REAL engines — adherence, the lap
 * alignment and the verdict — so what this asserts is what the sheet will say about
 * a real run, not about a fixture shaped to pass.
 */

const TOL: AdherenceTolerances = { distance: 0.15, duration: 0.15, paceSec: 5, hrBpm: 5 };
const step = (s: Partial<WorkoutStep>): WorkoutStep => ({
  order: 0, type: 'active', durationType: 'distance', targetType: 'no_target', ...s,
});
const lap = (distance: number, pace: number): Lap => ({ distance, duration: Math.round((distance / 1000) * pace), averagePace: pace });

function graded(workout: ParsedWorkout, laps: Lap[], actual: { distance: number; duration: number; averagePace: number }): WorkoutAdherenceRow {
  const planned = buildPlannedWorkout(workout, '2026-10-04');
  const row = assessWorkout(planned, { id: 'act-1', date: '2026-10-04', ...actual }, TOL);
  const efforts = effortReportFor(workout, laps, TOL.paceSec);
  const verdict = buildVerdict({
    activityId: 'act-1', athleteId: 'a1', adherence: row,
    segments: segmentReportFor(workout, laps, TOL.paceSec), efforts, tolerances: TOL, workoutName: workout.name,
  });
  return { ...row, execution: { activityId: 'act-1', status: verdict.status, score: verdict.score, direction: verdict.direction, workoutName: workout.name }, detail: { workout, laps, verdict, efforts } };
}

const INTERVALS: ParsedWorkout = {
  dayOfWeek: 0,
  name: 'אינטרוולים 3×800',
  steps: [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 340 }),
    step({
      type: 'interval', repeatCount: 3,
      repeatSteps: [
        step({ type: 'interval', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 250 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 90 }),
      ],
    }),
    step({ type: 'cooldown', durationValue: 1500, targetType: 'pace', targetPaceMinPerKm: 350 }),
  ],
};

describe('an interval session', () => {
  const laps = [lap(2000, 339), lap(800, 249), lap(250, 400), lap(800, 243), lap(250, 400), lap(800, 259), lap(250, 400), lap(1500, 362)];
  const row = graded(INTERVALS, laps, { distance: 6650, duration: 2300, averagePace: 330 });
  const sheet = buildWorkoutSheet({
    row, tolerances: TOL, today: '2026-10-06',
    activity: { startClock: '6:12', locationName: 'פארק הירקון', route: null },
    feedback: { text: 'חזרות מצוינות', mentorName: 'Dana Levi' },
  });

  it('is read through its reps, not through the whole-run average', () => {
    expect(sheet.pace?.label).toBe('קצב החזרות');
    expect(sheet.pace?.actual).toBe(Math.round((249 + 243 + 259) / 3));
    expect(sheet.chart?.mode).toBe('reps');
    expect(sheet.chart?.points.map((p) => [p.label, p.pace, p.kind])).toEqual([
      ['1', 249, 'on'], ['2', 243, 'fast'], ['3', 259, 'slow'],
    ]);
    // The green band is the target ± the manager's tolerance.
    expect([sheet.chart?.bandMin, sheet.chart?.bandMax, sheet.chart?.target]).toEqual([245, 255, 250]);
  });

  it('lists every paced step that was run, in Hebrew, with its verdict', () => {
    expect(sheet.steps.map((s) => [s.label, s.actual, s.verdict.kind, s.verdict.deltaSec])).toEqual([
      ['חימום 2 ק״מ', 339, 'on', 0],
      ['חזרה 1', 249, 'on', 0],
      ['חזרה 2', 243, 'fast', 7],
      ['חזרה 3', 259, 'slow', 9],
      ['שחרור 1.5 ק״מ', 362, 'slow', 12],
    ]);
  });

  it('carries the accuracy badge, the run, and the coach\'s words', () => {
    expect(sheet.badge?.kind).toBe('accuracy');
    expect(sheet.badge?.value).toBe(row.execution?.score);
    expect(sheet.activityId).toBe('act-1');
    expect(sheet.startClock).toBe('6:12');
    expect(sheet.feedback?.mentorName).toBe('Dana Levi');
  });

  it('never ships the raw laps', () => {
    expect(JSON.stringify(sheet)).not.toContain('"duration"');
    expect(sheet).not.toHaveProperty('detail');
  });
});

describe('an easy run cut short', () => {
  const EASY: ParsedWorkout = {
    dayOfWeek: 0, name: 'ריצה קלה 10 ק״מ',
    steps: [step({ durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: 340 })],
  };
  const laps = [341, 344, 352, 364, 375, 372].map((p) => lap(1000, p)).concat([lap(200, 380)]);
  const row = graded(EASY, laps, { distance: 6200, duration: 2223, averagePace: 358 });
  const sheet = buildWorkoutSheet({ row, tolerances: TOL, today: '2026-10-06', activity: null, feedback: null });

  it('is partial, with the share of the distance as its badge', () => {
    expect(sheet.status).toEqual({ kind: 'partial', pct: 62 });
    expect(sheet.badge).toEqual({ value: 62, kind: 'plan' });
  });

  it('says what is missing in the pace rule\'s words', () => {
    expect(sheet.distance.verdict).toEqual({ kind: 'less', delta: 3800 });
    expect(sheet.pace).toMatchObject({ label: 'קצב ממוצע', actual: 358, verdict: { kind: 'slow', deltaSec: 18 } });
    expect(sheet.time?.verdict?.kind).toBe('less');
  });

  it('charts kilometre by kilometre and drops the stub lap', () => {
    expect(sheet.chart?.mode).toBe('km');
    expect(sheet.chart?.points.map((p) => p.label)).toEqual(['ק״מ 1', '2', '3', '4', '5', '6']);
    expect(sheet.chart?.points.map((p) => p.kind)).toEqual(['on', 'on', 'slow', 'slow', 'slow', 'slow']);
  });
});

describe('a session not run', () => {
  it('has the plan and no verdicts', () => {
    const planned = buildPlannedWorkout(INTERVALS, '2026-10-08');
    const row: WorkoutAdherenceRow = { ...assessWorkout(planned, null, TOL), execution: null, detail: { workout: INTERVALS, laps: [], verdict: null, efforts: null } };
    const sheet = buildWorkoutSheet({ row, tolerances: TOL, today: '2026-10-06', activity: null, feedback: null });
    expect(sheet.status).toEqual({ kind: 'upcoming' });
    expect(sheet.badge).toBeNull();
    expect(sheet.distance.verdict).toBeNull();
    expect(sheet.chart).toBeNull();
    expect(sheet.steps).toEqual([]);
    expect(sheet.activityId).toBeNull();
  });
});

describe('lengthHe', () => {
  it('speaks the plan\'s lengths in Hebrew', () => {
    expect(lengthHe(2000)).toBe('2 ק״מ');
    expect(lengthHe(1500)).toBe('1.5 ק״מ');
    expect(lengthHe(800)).toBe('800 מ׳');
    expect(lengthHe(null, 45)).toBe('45 שנ׳');
    expect(lengthHe(null, 180)).toBe('3 דק׳');
    expect(lengthHe(null, 90)).toBe('1:30 דק׳');
  });
});
