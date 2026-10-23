import { describe, expect, it } from 'vitest';
import { withLanePaces } from '@/lib/plans/story-lanes';
import { workoutStoryText } from '@/lib/plans/workout-story-text';
import type { WorkoutStep } from '@/lib/ai/types';

const rep = (pace: number): WorkoutStep => ({ type: 'interval', durationType: 'distance', durationValue: 14000, targetType: 'pace', targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace } as WorkoutStep);

describe('the story copy has all three packs (10-23)', () => {
  it('puts lane 1, 2 and 3 in the club notation, whichever lane the screen held', () => {
    const steps = withLanePaces([[rep(230)], [rep(240)], [rep(250)]])!;
    expect(workoutStoryText({ dayOfWeek: 5, type: 'long', km: '24', steps })).toContain('14km @ 3:50 (4:00) ((4:10))');
  });
  it('a lane with a different session adds nothing rather than a wrong pace', () => {
    const steps = withLanePaces([[rep(230)], [rep(240), rep(240)], [rep(250)]])!;
    expect(workoutStoryText({ dayOfWeek: 5, type: 'long', km: '24', steps })).toContain('14km @ 3:50 ((4:10))');
  });
});
