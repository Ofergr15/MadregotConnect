import { describe, expect, it } from 'vitest';
import {
  parsedWorkoutToClipboard,
  workoutToClipboardText,
} from '@/lib/plans/clipboard';
import type { ParsedWorkout } from '@/lib/ai/types';

const workout: ParsedWorkout = {
  dayOfWeek: 2,
  name: 'מבחן 3000',
  workoutKey: 'day-2-part-2-test',
  partIndex: 2,
  partCount: 3,
  partKind: 'test',
  steps: [
    {
      order: 1,
      type: 'warmup',
      durationType: 'distance',
      durationValue: 1000,
      targetType: 'pace',
      targetPaceMinPerKm: 300,
      targetPaceMaxPerKm: 300,
    },
    {
      order: 2,
      type: 'interval',
      durationType: 'distance',
      durationValue: 3000,
      targetType: 'heart_rate',
      targetHrMinPct: 90,
      targetHrMaxPct: 95,
      notes: 'מאמץ מבחן',
    },
  ],
};

describe('clipboard canonical representation', () => {
  it('renders searchable text with part and target data', () => {
    const text = workoutToClipboardText(workout);
    expect(text).toContain('חלק 2 מתוך 3');
    expect(text).toContain('1 km, 5:00');
    expect(text).toContain('3 km, 90-95% HR, מאמץ מבחן');
  });

  it('uses the same details for the image renderer model', () => {
    const clipboard = parsedWorkoutToClipboard(workout);
    expect(clipboard.title).toBe('מבחן 3000');
    expect(clipboard.segments[1]).toMatchObject({
      kind: 'interval',
      detail: '3 km, 90-95% HR, מאמץ מבחן',
      distanceM: 3000,
    });
  });
});
