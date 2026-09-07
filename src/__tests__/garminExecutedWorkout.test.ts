import { describe, expect, it } from 'vitest';
import {
  isRepeatMarker, iterationsByStep, narrowExecutedWorkout, stepPaceBand,
} from '@/lib/garmin/executed-workout';

/**
 * Reading the workout the DEVICE ran, off `GET /activity/{id}/workouts`.
 *
 * Every fixture here is a real payload from the club's athletes, because the two things
 * that make this worth having are both things you would not guess:
 *  - a repeat is a flat MARKER step ("go back to step 2, eight times"), so its children
 *    keep one index each across every iteration and the marker itself never runs;
 *  - the pace target is usually the coach's prose, not a machine field.
 */

/** The club's published Sunday, as five athletes' watches had it. */
const sunday = [{
  index: 0,
  workoutName: 'ראשון 6.9',
  timeCreated: '2026-09-05T19:32:54.0',
  sport: 'RUNNING',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, targetType: null, targetValue: 0, targetValueLow: null, targetValueHigh: null, notes: '5:00-5:30' },
    { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 20000, targetType: null, targetValue: 0, notes: '4:25 (4:35) ((4:45))' },
    { stepIndex: 2, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 15, targetType: null, notes: 'עלייה' },
    { stepIndex: 3, intensity: 'REST', durationType: 'TIME', durationValue: 45, targetType: 'OPEN', notes: 'הליכה בירידה' },
    { stepIndex: 4, intensity: null, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 2, targetType: null, targetValue: 8 },
  ],
}];

/** A workout an athlete built themselves — and the one with real SPEED targets. */
const fiveK = [{
  index: 0,
  workoutName: '5KM',
  timeCreated: '2026-09-03T18:02:11.0',
  // A descending 5 km: each kilometre a little quicker than the last.
  steps: [[3.448, 3.509], [3.509, 3.571], [3.571, 3.636], [3.636, 3.704], [3.704, 3.774]]
    .map(([low, high], i) => ({
      stepIndex: i, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 1000,
      targetType: 'SPEED', targetValueLow: low, targetValueHigh: high,
    })),
}];

describe('narrowExecutedWorkout', () => {
  it('reads the step list a lap index points into', () => {
    const wk = narrowExecutedWorkout(sunday)!;
    expect(wk).toMatchObject({ name: 'ראשון 6.9', createdAt: '2026-09-05T19:32:54.0' });
    expect(wk.steps.map(s => [s.stepIndex, s.intensity, s.distanceM, s.durationSec])).toEqual([
      [0, 'WARMUP', 2000, undefined],
      [1, 'ACTIVE', 20000, undefined],
      [2, 'ACTIVE', undefined, 15],
      [3, 'REST', undefined, 45],
      [4, null, undefined, undefined],
    ]);
    // The coach's own text, kept verbatim — it is the target, not a comment.
    expect(wk.steps[1].notes).toBe('4:25 (4:35) ((4:45))');
  });

  it('reads a repeat as a marker pointing back, not as a container', () => {
    const wk = narrowExecutedWorkout(sunday)!;
    expect(wk.steps.filter(isRepeatMarker).map(s => [s.stepIndex, s.repeatFrom, s.iterations]))
      .toEqual([[4, 2, 8]]);
    // A marker has no length of its own; treating `durationValue` as one would invent a
    // two-second step that no lap will ever be stamped with.
    expect(wk.steps[4]).toMatchObject({ distanceM: undefined, durationSec: undefined });
  });

  // Garmin's target is SPEED in m/s, and the LOW speed is the SLOW end of the band.
  it('converts a machine speed target into a pace band', () => {
    const wk = narrowExecutedWorkout(fiveK)!;
    expect([wk.steps[0].paceMin, wk.steps[0].paceMax]).toEqual([285, 290]);
    expect([wk.steps[4].paceMin, wk.steps[4].paceMax]).toEqual([265, 270]);
  });

  it('says nothing for a run that was not driven by a workout', () => {
    // What the endpoint returns for an ordinary run — most runs.
    expect(narrowExecutedWorkout([])).toBeNull();
    expect(narrowExecutedWorkout(null)).toBeNull();
    expect(narrowExecutedWorkout([{ workoutName: 'x', steps: [] }])).toBeNull();
  });

  it('takes a single element as well as the array it came in', () => {
    expect(narrowExecutedWorkout(sunday[0])!.steps).toHaveLength(5);
  });
});

describe('iterationsByStep', () => {
  it('runs the marker\'s range as many times as it says', () => {
    const wk = narrowExecutedWorkout(sunday)!;
    expect([...iterationsByStep(wk)]).toEqual([[0, 1], [1, 1], [2, 8], [3, 8]]);
  });

  /**
   * A real Tuesday: three separate sets, so three markers, and they sit in the MIDDLE
   * of the list. This is what breaks any attempt to number our own plan's steps —
   * collapse the repeats and everything after the first marker is numbered one too low.
   */
  it('handles several sets at different points in the list', () => {
    const ladder = narrowExecutedWorkout([{
      workoutName: 'יום שלישי', steps: [
        { stepIndex: 0, intensity: 'WARMUP', durationType: 'OPEN' },
        { stepIndex: 1, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 30, notes: 'מתגברת' },
        { stepIndex: 2, intensity: 'REST', durationType: 'TIME', durationValue: 60, notes: 'הליכה' },
        { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 4 },
        { stepIndex: 4, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 300, notes: '3:20 (3:25) ((3:30))' },
        { stepIndex: 5, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 150, notes: 'הליכה' },
        { stepIndex: 6, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 4, targetValue: 5 },
        { stepIndex: 7, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
      ],
    }])!;
    expect([...iterationsByStep(ladder)])
      .toEqual([[0, 1], [1, 4], [2, 4], [4, 5], [5, 5], [7, 1]]);
  });

  it('multiplies a set nested inside another', () => {
    const nested = narrowExecutedWorkout([{
      workoutName: 'n', steps: [
        { stepIndex: 0, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 400 },
        { stepIndex: 1, intensity: 'REST', durationType: 'TIME', durationValue: 60 },
        { stepIndex: 2, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 2 },
        { stepIndex: 3, intensity: 'REST', durationType: 'TIME', durationValue: 180 },
        { stepIndex: 4, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 3 },
      ],
    }])!;
    // The inner pair runs 2×3 = 6 times; the outer rest 3.
    expect([...iterationsByStep(nested)]).toEqual([[0, 6], [1, 6], [3, 3]]);
  });
});

describe('stepPaceBand', () => {
  const wk = narrowExecutedWorkout(sunday)!;

  it('reads the coach\'s bracket notation at the athlete\'s lane', () => {
    expect(stepPaceBand(wk.steps[1], 1)).toEqual({ min: 265, max: 265 });
    expect(stepPaceBand(wk.steps[1], 2)).toEqual({ min: 275, max: 275 });
    expect(stepPaceBand(wk.steps[1], 3)).toEqual({ min: 285, max: 285 });
  });

  // One pace written for everybody is the common case, and every lane runs it.
  it('gives every lane the same band when only one was written', () => {
    for (const lane of [1, 2, 3] as const) {
      expect(stepPaceBand(wk.steps[0], lane)).toEqual({ min: 300, max: 330 });
    }
  });

  it('leaves a step ungraded when the note is an instruction, not a pace', () => {
    expect(stepPaceBand(wk.steps[2], 1)).toBeNull();   // "עלייה" — uphill
  });

  /**
   * A rest step's note is how to recover ("walk down"), and where the coach does write a
   * number there it is guidance, not a target the athlete should be marked down against.
   */
  it('never grades a rest, even one with a pace in its note', () => {
    expect(stepPaceBand({ ...wk.steps[3], notes: '7:00-8:00' }, 1)).toBeNull();
  });

  it('prefers the machine target when the workout has one', () => {
    const five = narrowExecutedWorkout(fiveK)!;
    expect(stepPaceBand({ ...five.steps[0], notes: '4:25 (4:35) ((4:45))' }, 3))
      .toEqual({ min: 285, max: 290 });
  });

  // The one step where the coach wrote the distance into the prose: "22km - 4:35-4:45".
  it('finds the pace in a note that also carries a distance', () => {
    expect(stepPaceBand({
      stepIndex: 0, intensity: 'ACTIVE', durationType: 'OPEN', notes: '22km - 4:35-4:45',
    }, 2)).toEqual({ min: 275, max: 285 });
  });
});
