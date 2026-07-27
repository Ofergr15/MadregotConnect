import { describe, it, expect } from 'vitest';
import { shareTextForDay, workoutToShareText } from '../workout-share';
import type { GroupedWeeklyPlans, ParsedWorkout } from '../ai/types';

// A synthetic interval workout mirroring the coach's format, with three groups.
function step(pace: number, sec: number) {
  return {
    order: 1,
    type: 'interval' as const,
    durationType: 'time' as const,
    durationValue: sec,
    targetType: 'pace' as const,
    targetPaceMinPerKm: pace,
    targetPaceMaxPerKm: pace,
  };
}

describe('workoutToShareText', () => {
  it('renders a repeat block with three-group bracket paces', () => {
    const mk = (p1: number): ParsedWorkout => ({
      dayOfWeek: 0,
      name: 'Sunday',
      steps: [
        { order: 1, type: 'interval', durationType: 'time', durationValue: undefined, targetType: 'no_target', repeatCount: 2,
          repeatSteps: [step(p1, 120), step(p1 + 15, 60)] },
      ],
    });
    const g1 = mk(205); // 3:25
    const g2 = mk(215); // 3:35
    const g3 = mk(225); // 3:45
    const text = workoutToShareText(g1, g2, g3);
    expect(text).toContain('2×');
    expect(text).toContain('2min @ 3:25 (3:35) ((3:45))');
    // second sub-step is +15s each group: 3:40 (3:50) ((4:00))
    expect(text).toContain('1min @ 3:40 (3:50) ((4:00))');
  });

  it('renders All-Out / effort notes without a pace', () => {
    const w: ParsedWorkout = {
      dayOfWeek: 0, name: 'x',
      steps: [{ order: 1, type: 'interval', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'All-Out' }],
    };
    expect(workoutToShareText(w)).toBe('2min @ All-Out');
  });

  it('renders a distance step', () => {
    const mk = (p: number): ParsedWorkout => ({
      dayOfWeek: 0, name: 'x',
      steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 6000, targetType: 'pace', targetPaceMinPerKm: p, targetPaceMaxPerKm: p }],
    });
    expect(workoutToShareText(mk(255), mk(264), mk(276))).toBe('6km @ 4:15 (4:24) ((4:36))');
  });

  it('returns null for a rest day', () => {
    const grouped: GroupedWeeklyPlans = {
      group1: { workouts: [{ dayOfWeek: 0, name: 'rest', steps: [] }] },
      group2: { workouts: [] },
      group3: { workouts: [] },
    };
    expect(shareTextForDay(grouped, 0)).toBeNull();
    expect(shareTextForDay(grouped, 3)).toBeNull();
  });
});
