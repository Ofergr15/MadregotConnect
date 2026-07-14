import { describe, it, expect } from 'vitest';
import { convertToGarminWorkout, ConvertOptions } from '../lib/garmin/converter';
import { getDefaultPaceProfile, paceToMetersPerSecond } from '../lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

const paceProfile = getDefaultPaceProfile();

// Wrap a single step in a ParsedWorkout and return the first converted Garmin step.
function convertSingle(step: Partial<WorkoutStep>, opts?: ConvertOptions) {
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
  return convertToGarminWorkout(workout, paceProfile, opts).workoutSegments[0].workoutSteps[0];
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

describe('convertToGarminWorkout — academy pace-zone target (paceTarget:true)', () => {
  it('emits a pace-zone target with a single bound for a single pace', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: 200, notes: '3:20' },
      { paceTarget: true }
    );
    expect(s.targetType.workoutTargetTypeId).toBe(6);
    expect(s.targetType.workoutTargetTypeKey).toBe('pace.zone');
    expect(s.targetValueOne).toBeCloseTo(paceToMetersPerSecond(200));
    expect(s.targetValueTwo).toBeUndefined(); // single pace → no slow bound
    // Pace still shown as text alongside the enforced target
    expect(s.description).toBe('3:20');
  });

  it('emits both bounds for a genuine pace range', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: 195, targetPaceMaxPerKm: 200 },
      { paceTarget: true }
    );
    expect(s.targetType.workoutTargetTypeKey).toBe('pace.zone');
    expect(s.targetValueOne).toBeCloseTo(paceToMetersPerSecond(195));
    expect(s.targetValueTwo).toBeCloseTo(paceToMetersPerSecond(200));
  });

  it('derives the pace-zone bounds from the zone when no numeric pace is set', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: undefined, targetZone: 'easy' },
      { paceTarget: true }
    );
    // default profile easy = 330-390
    expect(s.targetType.workoutTargetTypeKey).toBe('pace.zone');
    expect(s.targetValueOne).toBeCloseTo(paceToMetersPerSecond(330));
    expect(s.targetValueTwo).toBeCloseTo(paceToMetersPerSecond(390));
  });

  it('does not add a target to non-pace steps even with paceTarget:true', () => {
    const s = convertSingle(
      { type: 'rest', targetType: 'no_target', targetPaceMinPerKm: undefined, notes: 'הליכה' },
      { paceTarget: true }
    );
    expect(s.targetType.workoutTargetTypeKey).toBe('no.target');
    expect(s.targetValueOne).toBeUndefined();
  });

  it('applies the pace-zone target to steps inside a repeat group', () => {
    const s = convertSingle(
      {
        type: 'interval',
        targetType: 'no_target',
        targetPaceMinPerKm: undefined,
        durationType: 'open',
        repeatCount: 4,
        repeatSteps: [
          { order: 1, type: 'interval', durationType: 'distance', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 200, notes: '3:20' } as WorkoutStep,
          { order: 2, type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target', notes: 'הליכה' } as WorkoutStep,
        ],
      },
      { paceTarget: true }
    );
    expect(s.type).toBe('RepeatGroupDTO');
    const child = s.workoutSteps![0];
    expect(child.targetType.workoutTargetTypeKey).toBe('pace.zone');
    expect(child.targetValueOne).toBeCloseTo(paceToMetersPerSecond(200));
  });
});
