import { describe, expect, it } from 'vitest';
import { gradeWatchSteps } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import type { StoredLap } from '@/lib/garmin/laps';
import { proposedRepCompletion } from '@/lib/academy/rep-completion-proposal';

/**
 * CHARACTERIZATION of the (unwired) rep proposal against per-lap oddities a watch really produces, synthetic
 * laps only. It records what the proposal says today, including the gaps it still has, so a reviewer decides
 * with evidence. Nothing here changes the current `complete` flag or any surface.
 */
const workout = narrowExecutedWorkout([{ workoutName: 'Synthetic 5×1 km', steps: [
  { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: 'easy' },
  { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 1000, notes: '3:45 (3:55) ((4:05))' },
  { stepIndex: 2, intensity: 'REST', durationType: 'TIME', durationValue: 90, targetType: 'OPEN', notes: 'jog' },
  { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 5 },
  { stepIndex: 4, intensity: 'COOLDOWN', durationType: 'DISTANCE', durationValue: 2000, notes: 'easy' },
] }])!;
const lap = (distance: number, duration: number, step?: number): StoredLap => ({
  distance, duration, averagePace: Math.round(duration / (distance / 1000)), averageHR: null, maxHR: null,
  ...(step != null ? { wktStepIndex: step } : {}),
});
const rep = () => [lap(1000, 225, 1), lap(250, 90, 2)];
const say = (laps: StoredLap[]) => {
  const report = gradeWatchSteps(workout, laps, 1);
  const p = proposedRepCompletion(report, laps);
  return p && { reps: p.reps, run: `${p.repsRun}/${p.repsPlanned}`, skipped: p.skipped.length, currentComplete: report!.complete };
};

describe('rep proposal: per-lap cases (characterization)', () => {
  it('a manual lap press inside a rep (two consecutive laps, same step) is ONE rep', () => {
    const laps = [lap(2000, 620, 0), lap(500, 112, 1), lap(500, 113, 1), lap(250, 90, 2), ...Array.from({ length: 4 }, rep).flat(), lap(2000, 640, 4)];
    expect(say(laps)).toEqual({ reps: 'all_done', run: '5/5', skipped: 0, currentComplete: true });
  });
  it('an unstamped lap that is not a rep (a stray auto-lap before the warm-up) does not cast doubt when nothing is short', () => {
    const laps = [lap(300, 100), lap(2000, 620, 0), ...Array.from({ length: 5 }, rep).flat(), lap(2000, 640, 4)];
    expect(say(laps)).toEqual({ reps: 'all_done', run: '5/5', skipped: 0, currentComplete: true });
  });
  it('short AND an unstamped lap anywhere → unknown (it cannot tell where the unstamped lap sits)', () => {
    const laps = [lap(2000, 620, 0), ...Array.from({ length: 4 }, rep).flat(), lap(2000, 640, 4), lap(400, 150)];
    expect(say(laps)).toMatchObject({ reps: 'unknown', run: '4/5' });
  });
  it('GAP, recorded: a sixth rep (over-run) reads all_done 6/5; over-counting is not flagged', () => {
    const laps = [lap(2000, 620, 0), ...Array.from({ length: 6 }, rep).flat(), lap(2000, 640, 4)];
    expect(say(laps)).toEqual({ reps: 'all_done', run: '6/5', skipped: 0, currentComplete: true });
  });
  it('GAP, recorded: a recovery skipped with the lap button merges two reps into one stamped run → 4/5 missing', () => {
    // rep, rep back-to-back with no recovery lap between them: consecutive laps of step 1 are ONE occurrence.
    const laps = [lap(2000, 620, 0), lap(1000, 225, 1), lap(1000, 226, 1), lap(250, 90, 2), ...Array.from({ length: 3 }, rep).flat(), lap(2000, 640, 4)];
    expect(say(laps)).toMatchObject({ reps: 'missing', run: '4/5' });
  });
  it('no stamped laps at all (watch did not stamp) → no answer, never a count', () => {
    const laps = [lap(1000, 300), lap(1000, 300), lap(1000, 300)];
    expect(say(laps)).toBeNull();
  });
  it('cooldown cut short but run: reps all_done and nothing named skipped (truncation is not skipping)', () => {
    const laps = [lap(2000, 620, 0), ...Array.from({ length: 5 }, rep).flat(), lap(300, 100, 4)];
    expect(say(laps)).toEqual({ reps: 'all_done', run: '5/5', skipped: 0, currentComplete: true });
  });
});
