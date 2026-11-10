import { describe, expect, it } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { assessWorkout, buildPlannedWorkout, type AdherenceTolerances } from '@/lib/academy/adherence';
import { effortReportFor, segmentReportFor } from '@/lib/plan-execution/resolve';
import { buildVerdict } from '@/lib/plan-execution/verdict';
import type { WorkoutAdherenceRow } from '@/lib/academy/report';
import { effortRequirements, flattenPlannedSteps, type Lap } from '@/lib/academy/segments';
import { buildWorkoutSheet } from '@/lib/academy/workout-sheet';

/**
 * F10 (e2e): 2 km warmup, 6×800 @ 4:45–4:57 w/ 90 s rest, 2 km cooldown, run from
 * the watch. Garmin records 13 laps — no rest after the last rep — against 14
 * flattened steps. The sheet graded the warmup and cooldown (6:20 / 6:25) as the reps.
 */
const TOL: AdherenceTolerances = { distance: 0.15, duration: 0.15, paceSec: 5, hrBpm: 5 };
const step = (s: Partial<WorkoutStep>): WorkoutStep => ({
  order: 0, type: 'active', durationType: 'distance', targetType: 'no_target', ...s,
});
const lap = (distance: number, duration: number, hr: number): Lap => ({
  distance, duration, averagePace: duration / (distance / 1000), averageHR: hr,
});

const F10: ParsedWorkout = {
  dayOfWeek: 0,
  name: '6×800',
  steps: [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 364, targetPaceMaxPerKm: 404 }),
    step({
      type: 'interval', repeatCount: 6,
      repeatSteps: [
        step({ type: 'interval', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 285, targetPaceMaxPerKm: 297 }),
        step({ type: 'rest', durationType: 'time', durationValue: 90 }),
      ],
    }),
    step({ type: 'cooldown', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 364, targetPaceMaxPerKm: 404 }),
  ],
};

const REP_SEC = [233, 235, 236, 237, 238, 234];
const LAPS: Lap[] = [lap(2000, 760, 140)];
REP_SEC.forEach((sec, i) => {
  LAPS.push(lap(800, sec, 170 + i));
  if (i < REP_SEC.length - 1) LAPS.push(lap(200, 90, 150));
});
LAPS.push(lap(2000, 770, 145));

function graded(): WorkoutAdherenceRow {
  const planned = buildPlannedWorkout(F10, '2026-11-08');
  const distance = LAPS.reduce((s, l) => s + l.distance, 0);
  const duration = LAPS.reduce((s, l) => s + l.duration, 0);
  const row = assessWorkout(planned, { id: 'act-f10', date: '2026-11-08', distance, duration, averagePace: duration / (distance / 1000) }, TOL);
  const efforts = effortReportFor(F10, LAPS, TOL.paceSec);
  const verdict = buildVerdict({
    activityId: 'act-f10', athleteId: 'a1', adherence: row,
    segments: segmentReportFor(F10, LAPS, TOL.paceSec), efforts, tolerances: TOL, workoutName: F10.name,
  });
  return { ...row, execution: { activityId: 'act-f10', status: verdict.status, score: verdict.score, direction: verdict.direction, workoutName: F10.name }, detail: { workout: F10, laps: LAPS, verdict, efforts } };
}

describe('F10: warmup/cooldown are never the reps', () => {
  it('has 13 laps vs 14 flattened steps (the trailing rest is missing)', () => {
    expect(LAPS).toHaveLength(13);
    expect(flattenPlannedSteps(F10)).toHaveLength(14);
  });

  it('aligns despite the missing rest after the last rep and grades 6 reps in band', () => {
    const report = segmentReportFor(F10, LAPS, TOL.paceSec)!;
    expect(report.aligned).toBe(true);
    const reps = report.segments.filter(s => s.type === 'interval' && s.graded);
    expect(reps).toHaveLength(6);
    reps.forEach((r, i) => {
      expect(r.actualDistanceM).toBe(800);
      expect(r.actualPace).toBeCloseTo(REP_SEC[i] / 0.8, 5);
      expect(r.status).toBe('on_target');
    });
    expect(report.segments.find(s => s.type === 'warmup')?.actualDistanceM).toBe(2000);
    expect(report.segments.find(s => s.type === 'cooldown')?.actualDistanceM).toBe(2000);
  });

  it('effort search tags warmup/cooldown so they are never read as the reps', () => {
    const reqs = effortRequirements(flattenPlannedSteps(F10));
    const work = reqs.filter(r => r.stepType !== 'warmup' && r.stepType !== 'cooldown');
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ distanceM: 800, needed: 6, stepType: 'interval' });
    const efforts = effortReportFor(F10, LAPS, TOL.paceSec)!;
    const reps = efforts.requirements.find(r => r.distanceM === 800)!;
    expect(reps.paces.map(Math.round)).toEqual(REP_SEC.map(s => Math.round(s / 0.8)));
    expect(reps.found).toBe(6);
  });

  it('chart fallback (laps unaligned) skips the warmup/cooldown requirement', () => {
    const row = graded();
    const unaligned = { ...row, detail: { ...row.detail!, verdict: { ...row.detail!.verdict!, reps: [], repsAligned: false } } } as WorkoutAdherenceRow;
    const sheet = buildWorkoutSheet({ row: unaligned, tolerances: TOL, today: '2026-11-10', activity: { startClock: '6:00', locationName: null, route: null }, feedback: null });
    expect(sheet.chart?.points.map(p => p.pace)).toEqual(REP_SEC.map(s => Math.round(s / 0.8)));
  });

  it('the sheet reads the 800 m reps, not the warmup and cooldown', () => {
    const row = graded();
    const sheet = buildWorkoutSheet({ row, tolerances: TOL, today: '2026-11-10', activity: { startClock: '6:00', locationName: null, route: null }, feedback: null });
    expect(sheet.pace?.label).toBe('קצב החזרות');
    expect(sheet.pace?.actual).toBeGreaterThanOrEqual(291);
    expect(sheet.pace?.actual).toBeLessThanOrEqual(297);
    expect(sheet.chart?.points).toHaveLength(6);
    for (const p of sheet.chart!.points) {
      expect(p.pace).toBeGreaterThanOrEqual(291);
      expect(p.pace).toBeLessThanOrEqual(298);
      expect(p.kind).toBe('on');
    }
  });
});
