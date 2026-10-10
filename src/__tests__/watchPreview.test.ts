import { describe, it, expect } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { previewSessions, previewItems, previewHints, isRepeatItem } from '@/lib/plans/watch-preview';

// Sunday 11.10 as stored: the 4:00 "בין סטים" rest is the last step of the 3× hills.
const sunday: ParsedWorkout = {
  dayOfWeek: 0, name: 'יום ראשון',
  steps: [
    { order: 1, type: 'warmup', durationType: 'time', durationValue: 900, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315, notes: '4:40-5:15' },
    { order: 2, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', repeatCount: 3, repeatSteps: [
      { order: 1, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', notes: 'עליה' },
      { order: 2, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
      { order: 3, type: 'rest', durationType: 'time', durationValue: 240, targetType: 'no_target', notes: 'בין סטים' },
    ] },
    { order: 3, type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: 255, targetPaceMaxPerKm: 255,
      group2Pace: { min: 265, max: 265 }, group3Pace: { min: 275, max: 275 }, notes: '4:15 (4:25) ((4:35))' },
  ],
};
const grouped = splitIntoGroups({ workouts: normalizeWorkoutParts({ workouts: [sunday] }).workouts });

describe('the send sheet preview', () => {
  const [w] = previewSessions(grouped.group1.workouts, grouped);
  const items = previewItems(w);

  it('shows the watch text, all packs on the 40 minutes, a shared pace once', () => {
    expect(items[0]).toEqual({ type: 'warmup', duration: '15:00', text: '4:40–5:15' });
    expect(items[2]).toEqual({ type: 'active', duration: '40:00', text: '4:15 (4:25) ((4:35))' });
  });

  it('keeps a repeat as one block with its sub-steps and a lap press as no duration', () => {
    const rep = items[1];
    expect(isRepeatItem(rep) && rep.repeat).toBe(3);
    expect(isRepeatItem(rep) && rep.lines.map((l) => [l.duration, l.text])).toEqual([['0:30', 'עליה'], [null, 'עמידה הליכה למטה'], ['4:00', 'בין סטים']]);
  });

  it('matches the send even when the sessions on screen carry no workout key yet', () => {
    const bare = grouped.group1.workouts.map(({ workoutKey, ...rest }) => { void workoutKey; return rest as ParsedWorkout; });
    const [b] = previewSessions(bare, grouped);
    expect(previewItems(b)[2]).toMatchObject({ text: '4:15 (4:25) ((4:35))' });
  });

  it('flags a long rest that ends a repeat, and not a short one or a single pass', () => {
    expect(previewHints(w)).toEqual([{ kind: 'restEndsRepeat', seconds: 240, repeat: 3 }]);
    const short = { ...w, steps: w.steps.map((s) => (s.repeatSteps ? { ...s, repeatSteps: s.repeatSteps.map((c, j) => (j === 2 ? { ...c, durationValue: 60 } : c)) } : s)) };
    expect(previewHints(short)).toEqual([]);
    const once = { ...w, steps: w.steps.map((s) => (s.repeatSteps ? { ...s, repeatCount: 1 } : s)) };
    expect(previewHints(once)).toEqual([]);
  });
});
