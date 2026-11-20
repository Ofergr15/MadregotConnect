import { describe, expect, it } from 'vitest';
import { gradeWatchSteps } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import type { StoredLap } from '@/lib/garmin/laps';

/**
 * CHARACTERIZATION, not a fix: what the watch-step engine reports for "did they do the reps",
 * pinned on synthetic runs so the semantics can be discussed with evidence (trainee report,
 * 2026-11-20: "reps marked incomplete although completed"). Three numbers answer three questions:
 *   repeatsRun       — reps the watch stamped as run (done)
 *   repeatsOnTarget  — of the targeted reps, how many were inside the band (on pace)
 *   complete         — every step of the workout was run at least once (a skipped cooldown fails it;
 *                      a missing REP does not)
 * A surface that says "incomplete" or "partial" from one of these while the athlete means another is
 * the ambiguity. Nothing here changes behaviour.
 */

const workout = narrowExecutedWorkout([{
  workoutName: 'Synthetic 5×1 km',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: 'easy' },
    { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:45 (3:55) ((4:05))' },
    { stepIndex: 2, intensity: 'REST', durationType: 'TIME', durationValue: 90, targetType: 'OPEN', notes: 'jog' },
    { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 5 },
    { stepIndex: 4, intensity: 'COOLDOWN', durationType: 'DISTANCE', durationValue: 2000, notes: 'easy' },
  ],
}])!;

const lap = (distance: number, duration: number, wktStepIndex: number): StoredLap => ({
  distance, duration, averagePace: Math.round(duration / (distance / 1000)), averageHR: null, maxHR: null, wktStepIndex,
});
const run = (repPaces: number[], cooldown = true): StoredLap[] => [
  lap(2000, 620, 0),
  ...repPaces.flatMap(p => [lap(1000, p, 1), lap(250, 90, 2)]),
  ...(cooldown ? [lap(2000, 640, 4)] : []),
];
const ON = 225; // 3:45 — lane 1 target
const SLOW = 240; // 4:00 — outside lane 1's band
const grade = (laps: StoredLap[]) => {
  const r = gradeWatchSteps(workout, laps, 1)!;
  return { run: r.repeatsRun, planned: r.repeatsPlanned, onTarget: r.repeatsOnTarget, withTarget: r.repeatsWithTarget, complete: r.complete };
};

describe('rep semantics (characterization)', () => {
  it('all reps done on pace, cooldown run → 5/5 run, 5/5 on target, complete', () => {
    expect(grade(run([ON, ON, ON, ON, ON]))).toEqual({ run: 5, planned: 5, onTarget: 5, withTarget: 5, complete: true });
  });
  it('all reps DONE, two off pace → still 5/5 run; only 3 on target. "Partial" here means pace, not completion', () => {
    expect(grade(run([ON, SLOW, ON, SLOW, ON]))).toEqual({ run: 5, planned: 5, onTarget: 3, withTarget: 5, complete: true });
  });
  it('all reps done on pace, cooldown SKIPPED → 5/5 reps, yet complete=false', () => {
    expect(grade(run([ON, ON, ON, ON, ON], false))).toEqual({ run: 5, planned: 5, onTarget: 5, withTarget: 5, complete: false });
  });
  it('one rep MISSING, cooldown run → 4/5 run, but complete=true (complete does not count reps)', () => {
    expect(grade(run([ON, ON, ON, ON]))).toEqual({ run: 4, planned: 5, onTarget: 4, withTarget: 4, complete: true });
  });
});
