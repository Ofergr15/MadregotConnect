import { describe, expect, it } from 'vitest';
import { laneWorkouts } from '@/lib/academy/group-lane';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { convertToGarminWorkout } from '@/lib/garmin/converter';

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

  it('pace wins: the lane HR is not left on the step as a stale target', () => {
    const [w] = laneWorkouts(plan, 2);
    expect(w.steps[0]).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 235 });
    expect(w.steps[0].targetHrMinPct).toBeUndefined();
  });
  it('a 0 / null / non-numeric lane pace is not a pace: HR applies', () => {
    for (const bad of [{ min: 0, max: 0 }, null, { min: Number.NaN, max: Number.NaN }]) {
      const p = { workouts: [{ dayOfWeek: 5, name: 'Bad', steps: [{
        order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'pace',
        targetPaceMinPerKm: 270, group2Pace: bad, group2HeartRate: { min: 150, max: 160 },
      }] }] };
      const seg = flattenPlannedSteps(laneWorkouts(p as any, 2)[0])[0];
      expect(seg.metric).toBe('hr');
      expect(seg.hrTarget?.min).toBe(150);
    }
  });
  it('a 0 / missing lane HR never becomes a target', () => {
    const p = { workouts: [{ dayOfWeek: 5, name: 'NoHr', steps: [{
      order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'no_target',
      group2HeartRate: { min: 0, max: 0 },
    }] }] };
    const [w] = laneWorkouts(p as any, 2);
    expect(w.steps[0].targetType).toBe('no_target');
    expect(flattenPlannedSteps(w)[0].metric).toBe('none');
  });
  it('nested repeat: each rep stays on pace in lanes 2/3; an HR-only recovery inside stays HR', () => {
    const p = { workouts: [{ dayOfWeek: 6, name: 'Reps', steps: [{
      order: 1, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 3, repeatSteps: [
        { ...paceStepWithStrayHr, order: 1 },
        { order: 2, type: 'active', durationType: 'time', durationValue: 120, targetType: 'heart_rate',
          targetHrMinPct: 120, targetHrMaxPct: 130, group2HeartRate: { min: 118, max: 128 } },
      ] }] }] };
    const segs = flattenPlannedSteps(laneWorkouts(p as any, 2)[0]);
    expect(segs).toHaveLength(6);
    expect(segs.filter((_, i) => i % 2 === 0).map(s => [s.metric, s.paceMin])).toEqual([['pace', 235], ['pace', 235], ['pace', 235]]);
    expect(segs.filter((_, i) => i % 2 === 1).map(s => [s.metric, s.hrTarget?.min])).toEqual([['hr', 118], ['hr', 118], ['hr', 118]]);
  });

  it('watch side (academy pace targets on): the lane-2 pace step is pushed as a pace zone, not dropped to no target', () => {
    const [w] = laneWorkouts({ workouts: [{ dayOfWeek: 2, name: 'Synthetic', steps: [paceStepWithStrayHr] }] }, 2);
    const g = convertToGarminWorkout(w as any, null as any, { paceTarget: true });
    const step = (g.workoutSegments[0].workoutSteps as any[])[0];
    expect(step.targetType.workoutTargetTypeKey).toBe('pace.zone');
  });
});
