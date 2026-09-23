import { describe, expect, it } from 'vitest';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { getDefaultPaceProfile } from '@/lib/garmin/pace';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import type { GarminWorkoutStep } from '@/lib/garmin/types';

/**
 * "EDITABLE IN GARMIN CONNECT, BUT NOT SAVEABLE" (feedback ccc4e092).
 *
 * "האימונים שנשלחים לשעון ניתנים לעריכה באמצעות האפליקציה של Garmin Connect, אבל
 * לא ניתנים לשמירה."
 *
 * The watch reads the workout as a tree and ran it fine, so nothing about the
 * training was wrong. Garmin Connect's editor is the other reader: it FLATTENS the
 * tree into a row list keyed by `stepId`/`stepOrder`, and PUTs that list back when
 * you save. We were sending steps with no `stepId` at all and with `stepOrder`
 * restarting at 1 inside every repeat group, so the editor had several rows
 * claiming the same identity and nothing to name them by, and the save was refused.
 *
 * Everything here is about the identity Garmin needs to write the workout back —
 * not about its content, which these assertions deliberately leave alone.
 */

const paceProfile = getDefaultPaceProfile();

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

/** 2 km warm-up, 6×(400 m interval + 200 m recovery), 1 km cool-down. */
function intervalSession(): ParsedWorkout {
  return {
    name: 'אינטרוולים 6×400',
    dayOfWeek: 2,
    steps: [
      step({ type: 'warmup', durationValue: 2000 }),
      step({
        durationType: 'open',
        repeatCount: 6,
        repeatSteps: [
          step({ type: 'interval', durationValue: 400 }),
          step({ type: 'recovery', durationValue: 200 }),
        ],
      }),
      step({ type: 'cooldown', durationValue: 1000 }),
    ],
  } as unknown as ParsedWorkout;
}

/** Every step Garmin's editor will show, in the order it flattens them. */
function flatten(steps: GarminWorkoutStep[]): GarminWorkoutStep[] {
  return steps.flatMap((s) => [s, ...flatten(s.workoutSteps || [])]);
}

function convert(workout: ParsedWorkout) {
  return convertToGarminWorkout(workout, paceProfile).workoutSegments[0].workoutSteps;
}

describe('a workout we push can be saved after an edit in Garmin Connect', () => {
  it('numbers stepOrder once across the whole flattened workout', () => {
    const flat = flatten(convert(intervalSession()));
    // warm-up, the repeat group, its two children, cool-down.
    expect(flat).toHaveLength(5);
    expect(flat.map((s) => s.stepOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives every step a stepId of its own', () => {
    const flat = flatten(convert(intervalSession()));
    const ids = flat.map((s) => s.stepId);
    expect(ids.every((id) => typeof id === 'number' && id > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points a repeated step at the repeat group it belongs to', () => {
    const steps = convert(intervalSession());
    const group = steps.find((s) => s.type === 'RepeatGroupDTO')!;
    expect(group.workoutSteps?.map((s) => s.childStepId)).toEqual([group.stepId, group.stepId]);
    // Top-level steps belong to no group, and the editor reads that as null —
    // omitting the field is what made a warm-up look like an orphaned child.
    expect(steps.filter((s) => s !== group).every((s) => s.childStepId === null)).toBe(true);
    expect(group.childStepId).toBeNull();
  });

  it('states the iteration count where the editor reads it', () => {
    const group = convert(intervalSession()).find((s) => s.type === 'RepeatGroupDTO')!;
    expect(group.numberOfIterations).toBe(6);
    // The editor's "repeat N times" box is bound to endConditionValue, and it is
    // a required field: empty there means the save is refused.
    expect(group.endConditionValue).toBe(6);
    expect(group.smartRepeat).toBe(false);
  });

  it('keeps the tree the watch runs intact', () => {
    // The fix is about identity only. The nesting, the types and the distances
    // are what the athlete actually runs, and none of them may move.
    const steps = convert(intervalSession());
    expect(steps.map((s) => s.stepType.stepTypeKey)).toEqual(['warmup', 'repeat', 'cooldown']);
    const group = steps[1];
    expect(group.workoutSteps?.map((s) => s.stepType.stepTypeKey)).toEqual(['interval', 'recovery']);
    expect(group.workoutSteps?.map((s) => s.endConditionValue)).toEqual([400, 200]);
  });

  it('numbers a plain week of runs the same way', () => {
    const easy = {
      name: 'ריצה קלה 8 ק״מ',
      dayOfWeek: 0,
      steps: [step({ type: 'warmup' }), step({ durationValue: 8000 }), step({ type: 'cooldown' })],
    } as unknown as ParsedWorkout;
    const flat = flatten(convert(easy));
    expect(flat.map((s) => s.stepOrder)).toEqual([1, 2, 3]);
    expect(flat.map((s) => s.stepId)).toEqual([1, 2, 3]);
  });

  it('restarts the numbering for each workout, not for each push', () => {
    // Ids are unique *within* a workout; two sessions on the same day are two
    // separate files on the watch and must not be numbered as one.
    const a = flatten(convert(intervalSession()));
    const b = flatten(convert(intervalSession()));
    expect(b.map((s) => s.stepId)).toEqual(a.map((s) => s.stepId));
    expect(a[0].stepId).toBe(1);
  });

  it('numbers two repeat groups in one workout without collisions', () => {
    const doubleSet = {
      name: 'שני סטים',
      dayOfWeek: 4,
      steps: [
        step({ type: 'warmup', durationValue: 2000 }),
        step({ durationType: 'open', repeatCount: 4, repeatSteps: [step({ durationValue: 400 })] }),
        step({ durationType: 'open', repeatCount: 3, repeatSteps: [step({ durationValue: 200 })] }),
      ],
    } as unknown as ParsedWorkout;
    const steps = convert(doubleSet);
    const flat = flatten(steps);
    expect(flat.map((s) => s.stepOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(flat.map((s) => s.stepId)).size).toBe(5);
    // Each child follows its own group, which is the only thing that tells the
    // editor which "repeat" box a 200 m rep hangs under.
    expect(steps[1].workoutSteps?.[0].childStepId).toBe(steps[1].stepId);
    expect(steps[2].workoutSteps?.[0].childStepId).toBe(steps[2].stepId);
    expect(steps[1].stepId).not.toBe(steps[2].stepId);
  });
});
