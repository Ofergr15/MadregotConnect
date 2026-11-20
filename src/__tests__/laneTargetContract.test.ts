import { describe, expect, it } from 'vitest';
import { laneWorkouts } from '@/lib/academy/group-lane';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { convertToGarminWorkout } from '@/lib/garmin/converter';

/**
 * The lane target contract, both lanes, parameterized. Synthetic steps only.
 *  1. One pace per lane: valid explicit lane pace, else the bracket in the notes, else lane 1's.
 *  2. A pace-written step with a pace for the lane carries NO HR target (lane HR and lane 1's root HR cleared).
 *  3. A valid lane HR becomes the target only when the lane has no pace of its own, or the step is HR-written.
 *  4. An invalid range (0 / null / NaN / max < min) is never a pace and never a target.
 */
type Lane = 2 | 3;
const LANES: Lane[] = [2, 3];
const k = (lane: Lane, what: 'Pace' | 'HeartRate') => `group${lane}${what}`;
const base = { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000 };
const lane = (step: object, l: Lane) => splitIntoGroups({ workouts: [{ dayOfWeek: 2, name: 'S', steps: [step] }] } as any)[`group${l}`].workouts[0].steps[0] as any;
const seg = (step: object, l: Lane) => flattenPlannedSteps(laneWorkouts({ workouts: [{ dayOfWeek: 2, name: 'S', steps: [step] }] }, l)[0])[0];

describe.each(LANES)('lane %i', (l) => {
  const lanePace = { min: 220 + l * 10, max: 225 + l * 10 };
  const paceStep = (extra: object = {}) => ({ ...base, targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225,
    targetHrMinPct: 170, targetHrMaxPct: 180, [k(l, 'Pace')]: lanePace, [k(l, 'HeartRate')]: { min: 150, max: 160 }, ...extra });

  it('valid lane pace + stray lane HR → pace, at the lane pace, with BOTH HR fields cleared (lane and root)', () => {
    const s = lane(paceStep(), l);
    expect(s).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: lanePace.min, targetPaceMaxPerKm: lanePace.max });
    expect(s.targetHrMinPct).toBeUndefined();
    expect(s.targetHrMaxPct).toBeUndefined();
    expect(seg(paceStep(), l)).toMatchObject({ metric: 'pace', hrGraded: false, paceMin: lanePace.min });
  });

  it.each([
    ['zero', { min: 0, max: 0 }], ['null', null], ['NaN', { min: Number.NaN, max: Number.NaN }],
    ['NaN max', { min: 150, max: Number.NaN }], ['max < min', { min: 160, max: 150 }],
  ])('invalid lane HR (%s) never becomes a target', (_n, hr) => {
    const step = { ...base, targetType: 'no_target', [k(l, 'HeartRate')]: hr };
    expect(lane(step, l).targetType).toBe('no_target');
    expect(seg(step, l).metric).toBe('none');
  });

  it.each([
    ['zero', { min: 0, max: 0 }], ['NaN', { min: Number.NaN, max: 1 }], ['NaN max', { min: 230, max: Number.NaN }], ['max < min', { min: 240, max: 230 }],
  ])('invalid lane pace (%s) is not a pace: a valid lane HR then applies', (_n, bad) => {
    const s = seg(paceStep({ [k(l, 'Pace')]: bad }), l);
    expect(s.metric).toBe('hr');
    expect(s.hrTarget).toMatchObject({ min: 150, max: 160 });
  });

  it('a lane pace with no max is a single value (min = max)', () => {
    expect(lane(paceStep({ [k(l, 'Pace')]: { min: 238 } }), l)).toMatchObject({ targetPaceMinPerKm: 238, targetPaceMaxPerKm: 238, targetType: 'pace' });
  });

  it('an explicit HR-written step keeps HR, at the lane HR', () => {
    const step = { ...base, durationType: 'time', durationValue: 600, targetType: 'heart_rate', targetHrMinPct: 140, targetHrMaxPct: 150,
      [k(l, 'HeartRate')]: { min: 130, max: 140 } };
    expect(seg(step, l)).toMatchObject({ metric: 'hr', hrTarget: { min: 130, max: 140 } });
  });

  it('pace for lane 1 only, HR for this lane → HR for this lane (coach intent kept)', () => {
    const step = { ...base, targetType: 'pace', targetPaceMinPerKm: 270, [k(l, 'HeartRate')]: { min: 150, max: 160 } };
    expect(seg(step, l).metric).toBe('hr');
  });

  it('watch: academy pace targets push the lane pace as a pace zone', () => {
    const [w] = laneWorkouts({ workouts: [{ dayOfWeek: 2, name: 'S', steps: [paceStep()] }] }, l);
    const g = convertToGarminWorkout(w as any, null as any, { paceTarget: true });
    expect((g.workoutSegments[0].workoutSteps as any[])[0].targetType.workoutTargetTypeKey).toBe('pace.zone');
  });
});

describe('one pace per lane: explicit, else notes, independently per lane', () => {
  it('lane 2 explicit + lane 3 only in the notes → lane 3 takes its notes pace (not lane 1 inherited)', () => {
    const step = { ...base, targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 225, notes: '3:45 (3:55) ((4:05))',
      group2Pace: { min: 235, max: 235 }, group3HeartRate: { min: 145, max: 155 } };
    expect(lane(step, 2)).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 235 });
    expect(lane(step, 3)).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 245, targetPaceMaxPerKm: 245 });
    expect(lane(step, 3).targetHrMinPct).toBeUndefined();
  });
  it('an invalid own lane pace falls back to the notes for both the pace and the decision', () => {
    const step = { ...base, targetType: 'pace', targetPaceMinPerKm: 225, notes: '3:45 (3:55) ((4:05))',
      group2Pace: { min: 0, max: 0 }, group2HeartRate: { min: 150, max: 160 } };
    expect(lane(step, 2)).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 235 });
  });
  it('lane 1 is untouched: pace, root HR fields kept as written', () => {
    const step = { ...base, targetType: 'pace', targetPaceMinPerKm: 225, targetHrMinPct: 170, targetHrMaxPct: 180, group2HeartRate: { min: 150, max: 160 } };
    expect(splitIntoGroups({ workouts: [{ dayOfWeek: 2, name: 'S', steps: [step] }] } as any).group1.workouts[0].steps[0])
      .toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 225, targetHrMinPct: 170, targetHrMaxPct: 180 });
  });
  it('no lane pace and no lane HR → the step keeps lane 1\'s pace and type, as before', () => {
    const step = { ...base, targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 230 };
    for (const l of LANES) expect(lane(step, l)).toMatchObject({ targetType: 'pace', targetPaceMinPerKm: 225, targetPaceMaxPerKm: 230 });
  });
});
