import { describe, it, expect } from 'vitest';
import { repaceWeek, shiftWorkoutPaces, shiftPacesInNotes, MIN_PACE_SEC_PER_KM, MAX_PACE_SEC_PER_KM } from '../lib/academy/repace';
import { laneForBand, laneWorkouts, lanesDiffer } from '../lib/academy/group-lane';
import { effectiveOffsetSec } from '../lib/academy/bands';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'interval',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'pace',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], dayOfWeek = 0): ParsedWorkout {
  return { dayOfWeek, name: 'test', steps };
}

describe('repace — shifting a workout by a band offset', () => {
  it('adds the offset to both pace bounds', () => {
    const w = shiftWorkoutPaces(
      workout([step({ targetPaceMinPerKm: 200, targetPaceMaxPerKm: 210 })]),
      30,
    );
    expect(w.steps[0].targetPaceMinPerKm).toBe(230);
    expect(w.steps[0].targetPaceMaxPerKm).toBe(240);
  });

  it('subtracts a negative offset (a trainee faster than their band)', () => {
    const w = shiftWorkoutPaces(workout([step({ targetPaceMinPerKm: 240 })]), -20);
    expect(w.steps[0].targetPaceMinPerKm).toBe(220);
  });

  // The notes are what the watch PRINTS mid-run (buildStepDescription keeps them
  // verbatim once they hold a pace), so a shift that misses them shows the
  // trainee a pace they aren't being asked to run.
  it('shifts the pace written in the notes, not just the numeric fields', () => {
    const w = shiftWorkoutPaces(
      workout([step({ targetPaceMinPerKm: 200, notes: '3:20' })]),
      25,
    );
    expect(w.steps[0].notes).toBe('3:45');
    expect(w.steps[0].targetPaceMinPerKm).toBe(225);
  });

  it('shifts every token of a range in the notes', () => {
    expect(shiftPacesInNotes('4:15-4:25', 10)).toBe('4:25-4:35');
  });

  it('keeps the non-pace part of a note intact', () => {
    const w = shiftWorkoutPaces(workout([step({ notes: '3:20 ג׳ל' })]), 40);
    expect(w.steps[0].notes).toBe('4:00 ג׳ל');
  });

  // The gate that makes a blanket m:ss replace safe: a rest step's "2:00" is a
  // duration, and rest steps are never targetType 'pace'.
  it('leaves a non-pace step\'s notes alone even when they contain m:ss', () => {
    const w = shiftWorkoutPaces(
      workout([step({ type: 'rest', targetType: 'no_target', notes: '2:00 הליכה' })]),
      60,
    );
    expect(w.steps[0].notes).toBe('2:00 הליכה');
  });

  it('shifts steps nested inside a repeat group', () => {
    const w = shiftWorkoutPaces(
      workout([step({
        targetType: 'no_target',
        durationType: 'open',
        repeatCount: 6,
        repeatSteps: [
          step({ order: 1, durationValue: 800, targetPaceMinPerKm: 190, notes: '3:10' }),
          step({ order: 2, type: 'recovery', targetType: 'no_target', notes: 'הליכה' }),
        ],
      })]),
      15,
    );
    expect(w.steps[0].repeatSteps![0].targetPaceMinPerKm).toBe(205);
    expect(w.steps[0].repeatSteps![0].notes).toBe('3:25');
    expect(w.steps[0].repeatSteps![1].notes).toBe('הליכה');
  });

  it('shifts the club lanes too, so a row cannot contradict itself', () => {
    const w = shiftWorkoutPaces(
      workout([step({ targetPaceMinPerKm: 200, group2Pace: { min: 210, max: 215 }, group3Pace: { min: 220, max: 225 } })]),
      10,
    );
    expect(w.steps[0].targetPaceMinPerKm).toBe(210);
    expect(w.steps[0].group2Pace).toEqual({ min: 220, max: 225 });
    expect(w.steps[0].group3Pace).toEqual({ min: 230, max: 235 });
  });

  it('leaves heart-rate targets alone — a percentage of max HR is already individual', () => {
    const w = shiftWorkoutPaces(
      workout([step({ targetType: 'heart_rate', targetHrMinPct: 80, targetHrMaxPct: 88 })]),
      45,
    );
    expect(w.steps[0].targetHrMinPct).toBe(80);
    expect(w.steps[0].targetHrMaxPct).toBe(88);
  });

  // These numbers become a pace-zone alert on a real watch, so arithmetic that
  // escapes must not reach Garmin.
  it('clamps a pace that a big offset would push out of human range', () => {
    const fast = shiftWorkoutPaces(workout([step({ targetPaceMinPerKm: 180 })]), -120);
    expect(fast.steps[0].targetPaceMinPerKm).toBe(MIN_PACE_SEC_PER_KM);
    const slow = shiftWorkoutPaces(workout([step({ targetPaceMinPerKm: 1500 })]), 600);
    expect(slow.steps[0].targetPaceMinPerKm).toBe(MAX_PACE_SEC_PER_KM);
  });
});

describe('repaceWeek — null is not zero', () => {
  const week = [workout([step({ targetPaceMinPerKm: 200, notes: '3:20' })])];

  it('returns the week untouched when the paces cannot be resolved', () => {
    // Today's production state for every trainee: no band offset, no override.
    expect(effectiveOffsetSec(null, { paceProfile: {} })).toBeNull();
    const out = repaceWeek(week, null);
    expect(out).toBe(week); // same identity — nothing was rewritten
    expect(out[0].steps[0].notes).toBe('3:20');
  });

  it('returns the week untouched for an explicit +0 without rewriting anything', () => {
    expect(repaceWeek(week, 0)).toBe(week);
  });

  it('re-paces every workout of the week when an offset resolves', () => {
    const out = repaceWeek(
      [workout([step({ targetPaceMinPerKm: 200 })], 0), workout([step({ targetPaceMinPerKm: 300 })], 3)],
      20,
    );
    expect(out[0].steps[0].targetPaceMinPerKm).toBe(220);
    expect(out[1].steps[0].targetPaceMinPerKm).toBe(320);
  });

  it('a band offset of 0 and an unset band are different outcomes', () => {
    expect(effectiveOffsetSec(null, { paceProfile: { offsetSeconds: 0 } })).toBe(0);
    expect(effectiveOffsetSec(null, { paceProfile: {} })).toBeNull();
    // An athlete override wins over the band, including a negative one.
    expect(effectiveOffsetSec(-15, { paceProfile: { offsetSeconds: 40 } })).toBe(-15);
  });
});

describe('group-lane — importing one lane of a club plan', () => {
  // The unified stored shape: one workouts array carrying the coach's bracket
  // notation plus the structured per-group paces.
  const unified = {
    workouts: [{
      dayOfWeek: 2,
      name: 'אינטרוולים',
      steps: [step({
        targetPaceMinPerKm: 200,
        group2Pace: { min: 210, max: 210 },
        group3Pace: { min: 220, max: 220 },
        notes: '3:20 (3:30) ((3:40))',
      })],
    }],
  };

  it('resolves each lane to its own pace', () => {
    expect(laneWorkouts(unified, 1)[0].steps[0].targetPaceMinPerKm).toBe(200);
    expect(laneWorkouts(unified, 2)[0].steps[0].targetPaceMinPerKm).toBe(210);
    expect(laneWorkouts(unified, 3)[0].steps[0].targetPaceMinPerKm).toBe(220);
  });

  // A trainee gets one pace. An imported note still listing three is a note the
  // watch prints in full.
  it('rewrites the bracket notation down to the imported lane, lane 1 included', () => {
    expect(laneWorkouts(unified, 1)[0].steps[0].notes).toBe('3:20');
    expect(laneWorkouts(unified, 2)[0].steps[0].notes).toBe('3:30');
    expect(laneWorkouts(unified, 3)[0].steps[0].notes).toBe('3:40');
  });

  it('reads the older pre-split stored shape straight out of its bucket', () => {
    const split = {
      group1: { workouts: [workout([step({ targetPaceMinPerKm: 200 })])] },
      group2: { workouts: [workout([step({ targetPaceMinPerKm: 215 })])] },
      group3: { workouts: [workout([step({ targetPaceMinPerKm: 230 })])] },
    };
    expect(laneWorkouts(split, 2)[0].steps[0].targetPaceMinPerKm).toBe(215);
  });

  it('returns nothing for a plan with neither shape', () => {
    expect(laneWorkouts(null, 1)).toEqual([]);
    expect(laneWorkouts({}, 1)).toEqual([]);
    expect(laneWorkouts('nonsense', 1)).toEqual([]);
  });

  it('reports whether the lanes actually differ', () => {
    expect(lanesDiffer(unified)).toBe(true);
    // One pace for everybody — the common club week. Nothing to choose between.
    expect(lanesDiffer({ workouts: [workout([step({ targetPaceMinPerKm: 200, notes: '4:00' })])] })).toBe(false);
    expect(lanesDiffer({})).toBe(false);
  });

  it('defaults a lane from the band, and refuses to guess without one', () => {
    expect(laneForBand(4)).toBe(1);
    expect(laneForBand(5)).toBe(1);
    expect(laneForBand(6)).toBe(2);
    expect(laneForBand(7)).toBe(2);
    expect(laneForBand(8)).toBe(3);
    expect(laneForBand(9)).toBe(3);
    expect(laneForBand(null)).toBeNull();
    expect(laneForBand(undefined)).toBeNull();
  });

  // The whole point of the import: what the club runs, at the trainee's paces.
  it('composes with repaceWeek — lane first, then the band offset', () => {
    const lane = laneWorkouts(unified, 2);
    const out = repaceWeek(lane, 35);
    expect(out[0].steps[0].targetPaceMinPerKm).toBe(245);
    expect(out[0].steps[0].notes).toBe('4:05');
  });
});
