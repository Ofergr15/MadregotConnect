import { describe, it, expect } from 'vitest';
import { convertToGarminWorkout } from '../lib/garmin/converter';
import { getDefaultPaceProfile } from '../lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

const paceProfile = getDefaultPaceProfile();

// Wrap a single step in a ParsedWorkout and return the first converted Garmin step.
function convertSingle(step: Partial<WorkoutStep>) {
  const full: WorkoutStep = {
    order: 1,
    type: 'interval',
    durationType: 'time',
    durationValue: 45,
    targetType: 'pace',
    ...step,
  } as WorkoutStep;
  const workout = {
    name: 'test',
    dayOfWeek: 0,
    steps: [full],
  } as unknown as ParsedWorkout;
  return convertToGarminWorkout(workout, paceProfile).workoutSegments[0].workoutSteps[0];
}

describe('convertToGarminWorkout — pace as info, not an alerting target', () => {
  it('never emits a pace-zone target (no alert) for a pace step', () => {
    const s = convertSingle({ targetType: 'pace', targetPaceMinPerKm: 200 });
    expect(s.targetType.workoutTargetTypeId).toBe(1);
    expect(s.targetType.workoutTargetTypeKey).toBe('no.target');
    expect(s.targetValueOne).toBeUndefined();
    expect(s.targetValueTwo).toBeUndefined();
  });

  it('keeps the coach bracket notation verbatim when notes carry the pace', () => {
    const s = convertSingle({
      targetType: 'pace',
      targetPaceMinPerKm: 200,
      notes: '3:20 (3:30) ((3:40))',
    });
    expect(s.description).toBe('3:20 (3:30) ((3:40))');
  });

  it('synthesizes a pace range from numeric fields when notes are empty', () => {
    const s = convertSingle({
      targetType: 'pace',
      targetPaceMinPerKm: 195, // 3:15
      targetPaceMaxPerKm: 200, // 3:20
      notes: undefined,
    });
    expect(s.description).toBe('3:15-3:20');
  });

  it('synthesizes a single pace from a single numeric field', () => {
    const s = convertSingle({
      targetType: 'pace',
      targetPaceMinPerKm: 200, // 3:20
      notes: undefined,
    });
    expect(s.description).toBe('3:20');
  });

  it('synthesizes a pace range from the zone when only targetZone is set', () => {
    const s = convertSingle({
      targetType: 'pace',
      targetPaceMinPerKm: undefined,
      targetZone: 'easy', // default profile easy = 330-390 => 5:30-6:30
      notes: undefined,
    });
    expect(s.description).toBe('5:30-6:30');
  });

  it('prepends the synthesized pace to non-pace notes (e.g. gel cue)', () => {
    const s = convertSingle({
      targetType: 'pace',
      targetPaceMinPerKm: 200,
      notes: 'ג׳ל',
    });
    expect(s.description).toBe('3:20 ג׳ל');
  });

  it('leaves no_target steps with no pace target and just their notes', () => {
    const s = convertSingle({
      type: 'rest',
      durationType: 'time',
      durationValue: 120,
      targetType: 'no_target',
      targetPaceMinPerKm: undefined,
      notes: 'הליכה',
    });
    expect(s.targetType.workoutTargetTypeKey).toBe('no.target');
    expect(s.targetValueOne).toBeUndefined();
    expect(s.description).toBe('הליכה');
  });
});
