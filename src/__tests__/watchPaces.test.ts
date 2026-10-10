import { describe, it, expect } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { groupPaceText, notesWithoutPace } from '@/lib/plans/group-pace-text';
import { buildStepDescription } from '@/lib/garmin/converter';
import { joinGroupPaces } from '@/lib/garmin/pace';
import { setPackPaces, clearPace, packPaces, allPacksSame, stripPaceText } from '@/lib/plans/step-tree';

// Week 11.10 Sunday as the parse writes it before the per-pack split: the warm-up is
// one pace for everyone, the 40 minutes differ per pack.
const unified: ParsedWorkout = {
  dayOfWeek: 0, name: 'יום ראשון',
  steps: [
    { order: 1, type: 'warmup', durationType: 'time', durationValue: 900, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315, notes: '4:40-5:15' },
    { order: 2, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', repeatCount: 3, repeatSteps: [
      { order: 1, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', notes: 'עליה' },
      { order: 2, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
    ] },
    { order: 3, type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: 255, targetPaceMaxPerKm: 255,
      group2Pace: { min: 265, max: 265 }, group3Pace: { min: 275, max: 275 }, notes: '4:15 (4:25) ((4:35)) ג׳ל באמצע' },
  ],
};
// What the plan row actually holds: three copies, each narrowed to its own pack.
const stored = splitIntoGroups({ workouts: normalizeWorkoutParts({ workouts: [unified] }).workouts });
const PROFILE = {} as never;
const sent = (group: 1 | 2 | 3) =>
  withGroupPaces(normalizeWorkoutParts({ workouts: stored[`group${group}`].workouts }).workouts, stored)[0];

describe('a club week on the watch', () => {
  it('the stored pack copy really is narrowed (the cause)', () => {
    expect(stored.group2.workouts[0].steps[2].notes).toBe('4:25 ג׳ל באמצע');
    expect(stored.group2.workouts[0].steps[2].group3Pace).toBeUndefined();
  });

  it('shows every pack on the 40 minutes, whichever pack the runner is in', () => {
    for (const g of [1, 2, 3] as const) {
      expect(buildStepDescription(sent(g).steps[2], PROFILE)).toBe('4:15 (4:25) ((4:35)) ג׳ל באמצע');
    }
  });

  it('shows a pace everyone shares once', () => {
    expect(buildStepDescription(sent(2).steps[0], PROFILE)).toBe('4:40–5:15');
  });

  it("keeps the runner's own pace as the step's number", () => {
    expect(sent(3).steps[2].targetPaceMinPerKm).toBe(275);
  });

  it('leaves steps with no pace, and flat (academy) weeks, as they were', () => {
    expect(buildStepDescription(sent(2).steps[1].repeatSteps![0], PROFILE)).toBe('עליה');
    const flat = [{ ...unified, workoutKey: 'x' }];
    expect(withGroupPaces(flat, { workouts: flat })).toBe(flat);
  });

  it('falls back to the old text when the sent week no longer lines up with the saved one', () => {
    const edited = normalizeWorkoutParts({ workouts: stored.group2.workouts }).workouts;
    const changed = [{ ...edited[0], steps: edited[0].steps.map((s, i) => (i === 2 ? { ...s, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 } : s)) }];
    const out = withGroupPaces(changed, stored)[0];
    expect(out.steps[2].groupPaces).toBeUndefined();
    expect(out.steps[0].groupPaces).toBeDefined();
  });
});

describe('pace text', () => {
  it('collapses identical packs, keeps differing ones', () => {
    expect(groupPaceText([{ min: 240, max: 240 }, { min: 240, max: 240 }, { min: 240, max: 240 }])).toBe('4:00');
    expect(groupPaceText([{ min: 240, max: 250 }, { min: 250, max: 260 }, { min: 260, max: 270 }])).toBe('4:00–4:10 (4:10–4:20) ((4:20–4:30))');
    expect(joinGroupPaces(['4:40–5:15', '4:40–5:15', '4:40–5:15'])).toBe('4:40–5:15');
    expect(joinGroupPaces(['3:50', '4:00', '4:10'])).toBe('3:50 (4:00) ((4:10))');
  });

  it("removes only the pack's own pace from its note, not a duration", () => {
    expect(notesWithoutPace('4:20-4:10 ג׳ל', { min: 250, max: 260 })).toBe('ג׳ל');
    expect(notesWithoutPace('1:40:00, 4:15', { min: 255, max: 255 })).toBe('1:40:00');
    expect(notesWithoutPace('אחרי 2 קמ ג׳ל', { min: 280, max: 280 })).toBe('אחרי 2 קמ ג׳ל');
  });
});

describe('the builder writes all three packs', () => {
  const run: WorkoutStep = { order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'pace', targetPaceMinPerKm: 255, targetPaceMaxPerKm: 255, notes: '4:15 (4:25) ((4:35)) ג׳ל' };

  it('reads ❷/❸ as ❶ when the step has none', () => {
    expect(packPaces(run)).toEqual([{ min: 255, max: 255 }, { min: 255, max: 255 }, { min: 255, max: 255 }]);
    expect(allPacksSame(packPaces(run)!)).toBe(true);
  });

  it('sets all three and drops the stale pace text from the note', () => {
    const out = setPackPaces(run, [{ min: 250, max: 250 }, { min: 260, max: 260 }, { min: 275, max: 270 }]);
    expect([out.targetPaceMinPerKm, out.group2Pace, out.group3Pace]).toEqual([250, { min: 260, max: 260 }, { min: 270, max: 275 }]);
    expect(out.notes).toBe('ג׳ל');
    expect(clearPace(out).group2Pace).toBeUndefined();
    expect(stripPaceText('4:40-5:15')).toBeUndefined();
  });
});
