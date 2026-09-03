import { describe, it, expect } from 'vitest';
import { convertToGarminWorkout, ConvertOptions } from '../lib/garmin/converter';
import { getDefaultPaceProfile, getPaceForZone, paceToMetersPerSecond } from '../lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';
import { StoredPaceProfile } from '../lib/garmin/types';

const paceProfile = getDefaultPaceProfile();

// The shape every `groups.pace_profile` row in production actually has: a goal
// and a sec/km offset, no zone paces. The zone table above is a test fixture and
// nothing else, which is exactly why the zone path could throw in production for
// years while these tests stayed green.
const LIVE_PROFILE: StoredPaceProfile = { marathonGoal: 'SUB 2:30', offsetSeconds: 0 };

// Wrap a single step in a ParsedWorkout and return the first converted Garmin step.
function convertSingle(step: Partial<WorkoutStep>, opts?: ConvertOptions, profile: StoredPaceProfile = paceProfile) {
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
  return convertToGarminWorkout(workout, profile, opts).workoutSegments[0].workoutSteps[0];
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

// ── The production pace_profile shape ────────────────────────────────────────
//
// Every group in the live database stores `{ marathonGoal, offsetSeconds }` —
// there is no zone table anywhere — and push-workouts hands that object straight
// to the converter. A zone-only pace step therefore used to throw a TypeError
// (`Cannot read properties of undefined (reading 'min')`) inside
// convertToGarminWorkout, which the per-athlete try/catch in push-workouts turned
// into a failed delivery for that athlete's entire week. One such step exists in
// real plan data (the 2026-05-31 Saturday easy run), so this was reachable, not
// theoretical.
describe('convertToGarminWorkout — a pace_profile with no zone paces (production shape)', () => {
  it('getPaceForZone returns null instead of undefined', () => {
    expect(getPaceForZone('easy', LIVE_PROFILE)).toBeNull();
    expect(getPaceForZone('interval', LIVE_PROFILE)).toBeNull();
    expect(getPaceForZone('easy', {})).toBeNull();
    expect(getPaceForZone('easy', null)).toBeNull();
  });

  it('still resolves a real zone table, and still falls back to easy for an unknown zone', () => {
    expect(getPaceForZone('interval', paceProfile)).toEqual({ min: 240, max: 260 });
    expect(getPaceForZone('nonsense', paceProfile)).toEqual(paceProfile.easy);
  });

  it('converts a zone-only pace step without throwing', () => {
    expect(() => convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: undefined, targetZone: 'easy', notes: undefined },
      undefined,
      LIVE_PROFILE,
    )).not.toThrow();
  });

  it('omits the pace label rather than inventing one', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: undefined, targetZone: 'easy', notes: undefined },
      undefined,
      LIVE_PROFILE,
    );
    expect(s.description).toBeUndefined();
  });

  it('keeps the coach notes when there is no pace to add to them', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: undefined, targetZone: 'easy', notes: 'ריצה קלה' },
      undefined,
      LIVE_PROFILE,
    );
    expect(s.description).toBe('ריצה קלה');
  });

  it('leaves the step on no.target under paceTarget:true instead of alerting on an invented range', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: undefined, targetZone: 'easy' },
      { paceTarget: true },
      LIVE_PROFILE,
    );
    expect(s.targetType.workoutTargetTypeKey).toBe('no.target');
    expect(s.targetValueOne).toBeUndefined();
    expect(s.targetValueTwo).toBeUndefined();
  });

  it('a numeric pace is unaffected — it never needed the profile', () => {
    const s = convertSingle(
      { targetType: 'pace', targetPaceMinPerKm: 200, notes: '3:20' },
      { paceTarget: true },
      LIVE_PROFILE,
    );
    expect(s.targetType.workoutTargetTypeKey).toBe('pace.zone');
    expect(s.targetValueOne).toBeCloseTo(paceToMetersPerSecond(200));
    expect(s.description).toBe('3:20');
  });
});
