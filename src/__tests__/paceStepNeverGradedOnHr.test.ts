import { describe, expect, it } from 'vitest';
import { laneWorkouts } from '@/lib/academy/group-lane';
import { flattenPlannedSteps } from '@/lib/academy/segments';

/**
 * A step the coach prescribed by PACE must be graded on pace in every lane. Heart rate is judged
 * only when HR is the step's own target. segments.ts states the rule ("pace wins when a step carries
 * both"); splitStep used to break it for lanes 2 and 3 by flipping targetType to 'heart_rate' whenever
 * the parse attached a lane HR value. Synthetic plan, no athlete data.
 */
const paceStepWithStrayHr = {
  order: 1, type: 'interval', durationType: 'distance', durationValue: 1000,
  targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225,
  group2Pace: { min: 235, max: 235 }, group3Pace: { min: 245, max: 245 },
  group2HeartRate: { min: 150, max: 160 }, group3HeartRate: { min: 145, max: 155 },
  notes: '3:45 (3:55) ((4:05))',
};
const hrOnlyStep = {
  order: 2, type: 'active', durationType: 'time', durationValue: 1200,
  targetType: 'heart_rate', targetHrMinPct: 140, targetHrMaxPct: 150,
  group2HeartRate: { min: 135, max: 145 }, group3HeartRate: { min: 130, max: 140 },
};
const plan = { workouts: [{ dayOfWeek: 2, name: 'Synthetic', steps: [paceStepWithStrayHr, hrOnlyStep] }] };

describe('pace-only steps are never graded on heart rate', () => {
  for (const lane of [1, 2, 3] as const) {
    it(`lane ${lane}: the pace step is graded on pace, at that lane's pace`, () => {
      const [w] = laneWorkouts(plan, lane);
      const [seg] = flattenPlannedSteps(w);
      expect(seg.metric).toBe('pace');
      expect(seg.hrGraded).toBe(false);
      expect(seg.paceMin).toBe({ 1: 225, 2: 235, 3: 245 }[lane]);
    });
    it(`lane ${lane}: a step written in HR only is still graded on HR, at that lane's HR`, () => {
      const [w] = laneWorkouts(plan, lane);
      const seg = flattenPlannedSteps(w)[1];
      expect(seg.metric).toBe('hr');
      expect(seg.hrTarget?.min).toBe({ 1: 140, 2: 135, 3: 130 }[lane]);
    });
  }

  it('a step with a pace for lane 1 only and HR for lanes 2/3 stays HR for 2/3 (coach intent kept)', () => {
    const mixed = { workouts: [{ dayOfWeek: 3, name: 'Mixed', steps: [{
      order: 1, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'pace',
      targetPaceMinPerKm: 270, targetPaceMaxPerKm: 280,
      group2HeartRate: { min: 150, max: 160 }, group3HeartRate: { min: 145, max: 155 },
    }] }] };
    expect(flattenPlannedSteps(laneWorkouts(mixed, 1)[0])[0].metric).toBe('pace');
    expect(flattenPlannedSteps(laneWorkouts(mixed, 2)[0])[0].metric).toBe('hr');
    expect(flattenPlannedSteps(laneWorkouts(mixed, 3)[0])[0].metric).toBe('hr');
  });
  it('a lane pace that exists only in the bracket notes also keeps the step on pace', () => {
    const notesOnly = { workouts: [{ dayOfWeek: 4, name: 'Notes', steps: [{
      order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace',
      targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225, notes: '3:45 (3:55) ((4:05))',
      group2HeartRate: { min: 150, max: 160 },
    }] }] };
    const seg = flattenPlannedSteps(laneWorkouts(notesOnly, 2)[0])[0];
    expect(seg.metric).toBe('pace');
    expect(seg.paceMin).toBe(235);
  });
});
