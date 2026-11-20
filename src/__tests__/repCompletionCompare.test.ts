import { describe, expect, it } from 'vitest';
import { gradeWatchSteps } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import type { StoredLap } from '@/lib/garmin/laps';
import { proposedRepCompletion } from '@/lib/academy/rep-completion-proposal';

/**
 * CURRENT vs PROPOSED, side by side, on every synthetic case. The current flag is untouched (it is
 * still what every surface reads); the proposal is not wired anywhere. For review, not a decision.
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
const lap = (distance: number, duration: number, wktStepIndex?: number): StoredLap => ({
  distance, duration, averagePace: Math.round(duration / (distance / 1000)), averageHR: null, maxHR: null,
  ...(wktStepIndex != null ? { wktStepIndex } : {}),
});
const ON = 225, SLOW = 240;
const run = (reps: Array<number | 'unstamped'>, cooldown = true): StoredLap[] => [
  lap(2000, 620, 0),
  ...reps.flatMap(p => p === 'unstamped' ? [lap(1000, ON), lap(250, 90, 2)] : [lap(1000, p, 1), lap(250, 90, 2)]),
  ...(cooldown ? [lap(2000, 640, 4)] : []),
];
const both = (laps: StoredLap[]) => {
  const report = gradeWatchSteps(workout, laps, 1);
  const p = proposedRepCompletion(report, laps)!;
  return { currentComplete: report!.complete, reps: p.reps, run: `${p.repsRun}/${p.repsPlanned}`,
    onPace: `${p.onPace.inBand}/${p.onPace.targeted}`, skipped: p.skipped };
};

describe('rep completion: current vs proposed', () => {
  it('all done on pace', () => {
    expect(both(run([ON, ON, ON, ON, ON]))).toEqual({ currentComplete: true, reps: 'all_done', run: '5/5', onPace: '5/5', skipped: [] });
  });
  it('all done, two off pace: done is not partial; pace is reported on its own', () => {
    expect(both(run([ON, SLOW, ON, SLOW, ON]))).toEqual({ currentComplete: true, reps: 'all_done', run: '5/5', onPace: '3/5', skipped: [] });
  });
  it('all reps done, cooldown skipped: current says incomplete; proposal says reps all done and names the skipped step', () => {
    const r = both(run([ON, ON, ON, ON, ON], false));
    expect(r).toMatchObject({ currentComplete: false, reps: 'all_done', run: '5/5' });
    expect(r.skipped).toHaveLength(1);
  });
  it('a rep missing: current says complete; proposal says missing', () => {
    expect(both(run([ON, ON, ON, ON]))).toMatchObject({ currentComplete: true, reps: 'missing', run: '4/5' });
  });
  it('lap loss: a rep run in an unstamped lap → unknown, never counted as missing or done', () => {
    expect(both(run([ON, ON, 'unstamped', ON, ON]))).toMatchObject({ currentComplete: true, reps: 'unknown', run: '4/5' });
  });
  it('no structured workout data → no answer at all', () => {
    expect(proposedRepCompletion(null, [])).toBeNull();
  });
});
