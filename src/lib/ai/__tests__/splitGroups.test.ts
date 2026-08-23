import { describe, it, expect } from 'vitest';
import { splitIntoGroups, mergeGroupsToUnified } from '../splitGroups';
import type { ParsedWeeklyPlan, WorkoutStep } from '../types';

function step(overrides: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'interval',
    durationType: 'time',
    durationValue: 45,
    targetType: 'pace',
    ...overrides,
  };
}

describe('splitIntoGroups / mergeGroupsToUnified round-trip', () => {
  it('reproduces a single shared pace with no group overrides', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 0,
        name: 'Easy run',
        steps: [step({ type: 'active', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300, notes: '5:00' })],
      }],
    };
    const grouped = splitIntoGroups(plan);
    const merged = mergeGroupsToUnified(grouped);
    expect(merged.workouts[0].steps[0].targetPaceMinPerKm).toBe(300);
    expect(merged.workouts[0].steps[0].group2Pace).toBeUndefined();
    expect(merged.workouts[0].steps[0].group3Pace).toBeUndefined();
    expect(merged.workouts[0].steps[0].notes).toBe('5:00');
  });

  it('reconstructs group2Pace/group3Pace and bracket notes for a real parser-shaped step (bracket text in notes, no structured fields)', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 2,
        name: 'Interval ladder',
        steps: [
          step({ targetPaceMinPerKm: 200, targetPaceMaxPerKm: 200, notes: '3:20 (3:30) ((3:40))' }),
        ],
      }],
    };
    const grouped = splitIntoGroups(plan);
    // Sanity check the split itself resolved correctly before testing merge.
    expect(grouped.group1.workouts[0].steps[0].targetPaceMinPerKm).toBe(200);
    expect(grouped.group2.workouts[0].steps[0].targetPaceMinPerKm).toBe(210);
    expect(grouped.group3.workouts[0].steps[0].targetPaceMinPerKm).toBe(220);
    expect(grouped.group1.workouts[0].steps[0].notes).toBe('3:20');
    expect(grouped.group2.workouts[0].steps[0].notes).toBe('3:30');
    expect(grouped.group3.workouts[0].steps[0].notes).toBe('3:40');

    const merged = mergeGroupsToUnified(grouped);
    const merged1 = merged.workouts[0].steps[0];
    expect(merged1.targetPaceMinPerKm).toBe(200);
    expect(merged1.group2Pace).toEqual({ min: 210, max: 210 });
    expect(merged1.group3Pace).toEqual({ min: 220, max: 220 });
    expect(merged1.notes).toBe('3:20 (3:30) ((3:40))');

    // Full round-trip: re-splitting the merged plan must reproduce the exact
    // same three group plans — this is the guarantee the unified editor
    // depends on (edit once, split correctly every time it's saved/pushed).
    const reSplit = splitIntoGroups(merged);
    expect(reSplit).toEqual(grouped);
  });

  it('leaves non-pace notes untouched even when a group pace override is set directly', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 4,
        name: 'Recovery jog',
        steps: [
          step({ type: 'recovery', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 280, notes: 'הליכה', group2Pace: { min: 290, max: 290 } }),
        ],
      }],
    };
    const grouped = splitIntoGroups(plan);
    const merged = mergeGroupsToUnified(grouped);
    const merged1 = merged.workouts[0].steps[0];
    expect(merged1.group2Pace).toEqual({ min: 290, max: 290 });
    // Not a bare pace token — must not get bracket-mangled.
    expect(merged1.notes).toBe('הליכה');
  });

  it('recurses into repeat blocks', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 2,
        name: 'Repeats',
        steps: [
          step({
            repeatCount: 4,
            repeatSteps: [
              step({ targetPaceMinPerKm: 200, targetPaceMaxPerKm: 200, notes: '3:20 (3:25) ((3:30))' }),
              step({ type: 'rest', durationType: 'time', durationValue: 60, targetType: 'no_target', notes: 'הליכה' }),
            ],
          }),
        ],
      }],
    };
    const grouped = splitIntoGroups(plan);
    const merged = mergeGroupsToUnified(grouped);
    const sub0 = merged.workouts[0].steps[0].repeatSteps![0];
    expect(sub0.group2Pace).toEqual({ min: 205, max: 205 });
    expect(sub0.group3Pace).toEqual({ min: 210, max: 210 });
    expect(sub0.notes).toBe('3:20 (3:25) ((3:30))');
    const sub1 = merged.workouts[0].steps[0].repeatSteps![1];
    expect(sub1.group2Pace).toBeUndefined();
    expect(sub1.notes).toBe('הליכה');

    expect(splitIntoGroups(merged)).toEqual(grouped);
  });
});
