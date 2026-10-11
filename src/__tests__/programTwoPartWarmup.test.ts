import { describe, it, expect } from 'vitest';
import { summarizeSteps } from '@/components/WorkoutDetailModal';

// Tuesday 2026-10-06 as stored (feedback #104): a two-part warm-up, then the session.
const tuesday = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, notes: '5:00' },
  { order: 2, type: 'warmup', durationType: 'distance', durationValue: 3000, targetType: 'pace', targetPaceMinPerKm: 280, notes: '4:40' },
  { order: 3, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' },
];

describe('program screen: a two-part warm-up', () => {
  it('shows both warm-up segments, not just the first', () => {
    const blocks = summarizeSteps(tuesday);
    const phases = blocks.filter((b) => b.type === 'phase');
    expect(phases.map((b) => [b.steps.length, b.steps[0].durationValue])).toEqual([[1, 2000], [1, 3000]]);
    expect(blocks.map((b) => b.type)).toEqual(['phase', 'phase', 'rest']);
  });
});
