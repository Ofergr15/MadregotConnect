import { describe, expect, it } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { dominantBlock, gradeWorkoutBlocks, traceFromLaps, traceFromStream } from '@/lib/academy/execution';
import { findPlannedEfforts, flattenPlannedSteps, type Lap } from '@/lib/academy/segments';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';
import { dominantWatchStep, gradeWatchSteps, partialWatchStep } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import { normalizeStoredLaps, type StoredLap } from '@/lib/garmin/laps';

/**
 * One case per production failure listed in CLAUDE.md ("Did they do the workout"),
 * end to end through the engine that got it wrong. The per-function suites
 * (academyExecution / academyWatchSteps / academySegments / storedLaps) hold the
 * unit detail; this file is the index: if any row here goes red, a verdict an
 * athlete already saw once is wrong again.
 */

let order = 0;
const step = (over: Partial<WorkoutStep>): WorkoutStep => ({
  order: order++, type: 'active', durationType: 'distance', targetType: 'pace', ...over,
});
const workout = (steps: WorkoutStep[]): ParsedWorkout => ({ dayOfWeek: 0, name: 'Sunday', steps });

/** "2 km easy, 20 km at 4:25, 8×15 s strides" — Group 1. */
const SUNDAY = workout([
  step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
  step({ durationValue: 20000, targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265 }),
  step({
    repeatCount: 8, type: 'interval', durationType: 'time', targetType: 'no_target',
    repeatSteps: [
      step({ type: 'interval', durationType: 'time', durationValue: 15, targetPaceMinPerKm: 200, targetPaceMaxPerKm: 210 }),
      step({ type: 'recovery', durationType: 'time', durationValue: 45, targetType: 'no_target' }),
    ],
  }),
]);

const slap = (distance: number, duration: number, wktStepIndex?: number): StoredLap => ({
  distance, duration,
  averagePace: distance > 0 ? Math.round(duration / (distance / 1000)) : null,
  averageHR: null, maxHR: null,
  ...(wktStepIndex != null ? { wktStepIndex } : {}),
});
const lap = (distance: number, duration: number): Lap => ({ distance, duration });
const times = <T>(n: number, f: (i: number) => T[]): T[] => Array.from({ length: n }, (_, i) => f(i)).flat();

/** A 1 Hz-ish stream at a constant pace, optionally with a standstill at `pauseAtM`. */
function stream(segments: { m: number; pace: number }[], pause?: { atM: number; sec: number }, startM = 0) {
  const t: number[] = []; const d: number[] = [];
  let sec = 0; let m = startM; let paused = false;
  for (const seg of segments) {
    const end = m + seg.m;
    for (; m < end; m += 50) {
      if (pause && !paused && m >= pause.atM) { t.push(Math.round(sec)); d.push(m); sec += pause.sec; paused = true; }
      t.push(Math.round(sec)); d.push(m);
      sec += (seg.pace * 50) / 1000;
    }
  }
  t.push(Math.round(sec)); d.push(m);
  return { t, d };
}

describe('production failures — each stays fixed', () => {
  // 1. Repeat markers occupy an index and never run, so everything after the first
  //    set was numbered one too low when read against our parsed plan.
  it('repeat markers mid-list: each lap is graded against the step the watch says it was', () => {
    const tuesday = narrowExecutedWorkout([{
      workoutName: 'שלישי',
      steps: [
        { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
        { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:40 (3:50)' },
        { stepIndex: 2, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 90, notes: 'ג׳וג' },
        { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 3 },
        { stepIndex: 4, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 400, notes: '3:20 (3:30)' },
        { stepIndex: 5, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 60, notes: 'ג׳וג' },
        { stepIndex: 6, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 4, targetValue: 4 },
      ],
    }])!;
    const laps = [
      slap(1000, 310, 0), slap(1000, 312, 0),
      ...times(3, () => [slap(1000, 220, 1), slap(250, 90, 2)]),
      ...times(4, () => [slap(400, 80, 4), slap(150, 60, 5)]),
    ];
    const report = gradeWatchSteps(tuesday, laps, 1)!;
    const byIndex = Object.fromEntries(report.steps.map(s => [s.index, s]));
    expect(byIndex[1]).toMatchObject({ label: 'Interval 1km', ranRepeats: 3, actualPace: 220, status: 'on_target' });
    expect(byIndex[4]).toMatchObject({ label: 'Interval 400m', ranRepeats: 4, actualPace: 200, status: 'on_target' });
    expect(report.steps.map(s => s.index)).not.toContain(3);
    expect(report.steps.map(s => s.index)).not.toContain(6);
  });

  // 2. A workout nobody pushed: one open 22 km step. Read against the club plan every
  //    index landed in range and the verdict said "warm-up: 22 km".
  it('a single open 22 km step is graded as itself, never as the plan\'s warm-up', () => {
    const own = narrowExecutedWorkout([{
      workoutName: 'הריצה שלי',
      steps: [{ stepIndex: 0, intensity: 'ACTIVE', durationType: 'OPEN', notes: '2 קל, 20 ב-4:25 (4:35)' }],
    }])!;
    const report = gradeWatchSteps(own, times(22, () => [slap(1000, 270, 0)]), 1)!;
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].type).not.toBe('warmup');
    expect(report.steps[0].label).not.toMatch(/warm/i);
    expect(report.steps[0].truncated).toBe(false);
    expect(report.steps[0].actualDistanceM).toBe(22000);
  });

  // 3. A 97-228 s stop inside the 20 km block's window made a 4:23 block read 4:34.
  it('a pause inside the block does not slow the block\'s pace', () => {
    const s = stream([{ m: 2000, pace: 300 }, { m: 20000, pace: 263 }], { atM: 14000, sec: 228 });
    const report = gradeWorkoutBlocks(SUNDAY, traceFromStream(s));
    expect(report.blocks[1].status).toBe('on_target');
    expect(Math.abs((report.blocks[1].actualPace ?? 0) - 263)).toBeLessThanOrEqual(2);
    expect(dominantBlock(report)?.status).toBe('on_target');
  });

  // 4. The Strava copy of a 6×2 km session: a 45-point lap trace is too coarse to
  //    place 2 km blocks between 522 m recoveries. The watch's own stamped laps grade
  //    it correctly, and the coarse trace says how coarse it is so callers can weigh it.
  it('6×2 km graded from stamped laps is on target; a lap trace reports its coarse resolution', () => {
    const ex = narrowExecutedWorkout([{
      workoutName: 'שלישי כפול',
      steps: [
        { stepIndex: 0, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 2000, notes: '3:30 (3:40)' },
        { stepIndex: 1, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 500, notes: 'ג׳וג' },
        { stepIndex: 2, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 6 },
      ],
    }])!;
    const paces = [214, 215, 210, 210, 205, 217];
    const laps = paces.flatMap(p => [slap(2000, p * 2, 0), slap(522, 200, 1)]);
    const report = gradeWatchSteps(ex, laps, 1)!;
    expect(report.steps[0]).toMatchObject({ ranRepeats: 6 });
    expect(report.repeatsOnTarget).toBeGreaterThanOrEqual(5);

    const stravaKmSplits: Lap[] = times(15, () => [lap(1000, 250)]);
    expect(traceFromLaps(stravaKmSplits)!.resolutionM).toBeGreaterThanOrEqual(1000);
  });

  // 5. Abandoned at rep 5 of 6: rep 4 is on target and every step was run at least
  //    once, so `complete` stays true by design — only the distance row says the
  //    session didn't happen, and the repeat count shows how far it got.
  it('a run cut short at rep 5: the distance row is under, the reps run are counted', () => {
    const ex = narrowExecutedWorkout([{
      workoutName: 'סולם',
      steps: [
        { stepIndex: 0, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:40 (3:50)' },
        { stepIndex: 1, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 90, notes: 'ג׳וג' },
        { stepIndex: 2, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 6 },
      ],
    }])!;
    const laps = [...times(4, () => [slap(1000, 220, 0), slap(250, 90, 1)]), slap(400, 95, 0)];
    const report = gradeWatchSteps(ex, laps, 1)!;
    expect(report.complete).toBe(true);
    expect(report.steps[0]).toMatchObject({ ranRepeats: 5, plannedRepeats: 6, truncated: true });
    expect(report.steps[0].occurrences.slice(0, 4).every(o => o.status === 'on_target')).toBe(true);

    const plan = workout([step({
      repeatCount: 6, type: 'interval', targetType: 'no_target',
      repeatSteps: [
        step({ type: 'interval', durationValue: 1000, targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' }),
      ],
    })]);
    const verdict = assessWorkout(buildPlannedWorkout(plan, '2026-09-08'), {
      id: 'a', date: '2026-09-08', distance: 5400, duration: 1335, averagePace: 247,
    });
    expect(verdict.distance.status).toBe('under');
    // A truncated step never becomes the headline verdict.
    expect(dominantWatchStep(report)).toBeNull();
    expect(partialWatchStep(report)?.truncated ?? true).toBe(true);
  });

  // 6. Garmin's first sample sits at 1-3 m; below d[0] the window search found
  //    nothing, which killed every block verdict on a run far short of the plan.
  it.each([1, 2, 3])('a trace whose first sample is at %i m still grades an early-ended run', (startM) => {
    const s = stream([{ m: 2000, pace: 300 }, { m: 9000, pace: 263 }], undefined, startM);
    const trace = traceFromStream(s)!;
    expect(trace.d[0]).toBe(0);
    const report = gradeWorkoutBlocks(SUNDAY, trace);
    expect(report.blocks[0].window).toMatchObject({ startM: 0 });
    expect(report.blocks[1]).toMatchObject({ truncated: true, status: 'on_target' });
  });

  // 7. A 15 s stride converted to metres through its 3:20 target is 75 m; run at
  //    4:10 it is 60 m and was reported as never run. Timed reps match on duration.
  it.each([
    ['on pace', 75],
    ['off pace (4:10)', 60],
    ['fast (2:50)', 88],
  ])('timed strides %s are all found', (_name, metres) => {
    const laps: Lap[] = [
      lap(1000, 300), lap(1000, 300), ...times(20, () => [lap(1000, 263)]),
      ...times(8, () => [lap(metres, 15), lap(60, 45)]),
    ];
    const strides = findPlannedEfforts(flattenPlannedSteps(SUNDAY), laps).requirements.find(r => r.durationSec === 15)!;
    expect(strides).toMatchObject({ matchBy: 'duration', needed: 8, attempted: 8 });
  });

  // 8. Three writers have filled athlete_activities.laps; a reader that only knows
  //    Garmin's `duration` returned zero-duration laps.
  it.each([
    ['Garmin narrowed', { distance: 1000, duration: 270 }],
    ['raw DTO (movingDuration)', { distance: 1000, movingDuration: 270 }],
    ['Strava split (moving_time)', { distance: 1000, moving_time: 270 }],
  ])('normalizeStoredLaps reads a %s lap with its real duration', (_name, raw) => {
    const [out] = normalizeStoredLaps([raw]);
    expect(out.duration).toBe(270);
    expect(out.averagePace).toBe(270);
  });
});
