import { describe, it, expect } from 'vitest';
import {
  buildVerdict,
  closeness,
  directionFromDeviations,
  paceDeviation,
  rangeDeviation,
  toExecutionSummary,
  REPS_WEIGHT,
  ZERO_AT_TOLERANCE_MULTIPLE,
} from '@/lib/plan-execution/verdict';
import {
  assessWorkout,
  buildPlannedWorkout,
  DEFAULT_TOLERANCES,
  type ActualActivity,
} from '@/lib/academy/adherence';
import { flattenPlannedSteps, matchLapsToSteps, type Lap } from '@/lib/academy/segments';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

/**
 * The engine behind the accuracy ring.
 *
 * Built on the REAL adherence and segment engines rather than hand-written
 * fixtures, because the whole point of `verdict.ts` is that it adds direction and
 * one percentage on top of those two — a fixture that drifts from what
 * `assessWorkout` actually returns would test nothing.
 *
 * The 4×2000 below is the case the feature was designed on: two runners, one who
 * ran every rep ~13 s/km too fast and one who ran to plan. Their adherence scores
 * are indistinguishable, which is exactly why direction exists.
 */

const DATE = '2026-07-13';

/** 4×2000 m at 3:20–3:30 /km with 2 min recoveries, plus warmup and cooldown. */
function fourByTwoK(): ParsedWorkout {
  const rep: WorkoutStep = {
    order: 1, type: 'interval', durationType: 'distance', durationValue: 2000,
    targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 210,
  } as WorkoutStep;
  const recovery: WorkoutStep = {
    order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target',
  } as WorkoutStep;
  return {
    dayOfWeek: 1,
    name: '4x2000',
    steps: [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
      { order: 2, type: 'interval', durationType: 'open', repeatCount: 4, repeatSteps: [rep, recovery] },
      { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
    ] as WorkoutStep[],
  } as ParsedWorkout;
}

/** Warmup, then 4 × (2 km rep at `repPace`, 2 min recovery), then cooldown. */
function lapsAt(repPace: number): Lap[] {
  const laps: Lap[] = [{ distance: 2000, duration: 2000 * (300 / 1000), averagePace: 300 }];
  for (let i = 0; i < 4; i++) {
    laps.push({ distance: 2000, duration: Math.round(2000 * (repPace / 1000)), averagePace: repPace });
    laps.push({ distance: 400, duration: 120, averagePace: 300 });
  }
  laps.push({ distance: 2000, duration: 600, averagePace: 300 });
  return laps;
}

function run(overrides: Partial<ActualActivity> = {}): ActualActivity {
  return {
    id: 'act-1', date: DATE, distance: 13600, duration: 3400, movingDuration: 3400,
    averagePace: 250, ...overrides,
  };
}

function verdictFor(repPace: number, actual: ActualActivity) {
  const workout = fourByTwoK();
  const planned = buildPlannedWorkout(workout, DATE);
  return buildVerdict({
    activityId: actual.id,
    athleteId: 'ath-1',
    adherence: assessWorkout(planned, actual, DEFAULT_TOLERANCES),
    segments: matchLapsToSteps(flattenPlannedSteps(workout), lapsAt(repPace), DEFAULT_TOLERANCES.paceSec),
    workoutName: workout.name,
  });
}

describe('closeness', () => {
  it('is 1 inside the tolerated band and 0 at the far edge', () => {
    expect(closeness(0, 5)).toBe(1);
    expect(closeness(-3, 5)).toBe(1); // already inside; negatives can't reduce it
    expect(closeness(5 * ZERO_AT_TOLERANCE_MULTIPLE, 5)).toBe(0);
    expect(closeness(100, 5)).toBe(0); // clamped, never negative
  });

  it('decays linearly in between', () => {
    // 5 s/km outside a ±5 band, zeroing at 15 → 1 - 5/15
    expect(closeness(5, 5)).toBeCloseTo(2 / 3, 5);
    expect(closeness(7.5, 5)).toBeCloseTo(0.5, 5);
  });

  it('scores 0 rather than dividing by zero when there is no tolerance', () => {
    expect(closeness(1, 0)).toBe(0);
  });
});

describe('paceDeviation', () => {
  const T = 5;
  it('is 0 anywhere inside the band plus its tolerance', () => {
    expect(paceDeviation(205, 200, 210, T)).toBe(0);
    expect(paceDeviation(195, 200, 210, T)).toBe(0); // on the fast tolerance edge
    expect(paceDeviation(215, 200, 210, T)).toBe(0); // on the slow tolerance edge
  });

  it('is negative for faster than asked and positive for slower', () => {
    expect(paceDeviation(190, 200, 210, T)).toBe(-5);
    expect(paceDeviation(220, 200, 210, T)).toBe(5);
  });

  it('is null when there is nothing to compare', () => {
    expect(paceDeviation(null, 200, 210, T)).toBeNull();
    expect(paceDeviation(200, null, null, T)).toBeNull();
  });
});

describe('rangeDeviation', () => {
  it('measures from the tolerated edge, in the metric\'s own unit', () => {
    // 10 km ±15% → 8500..11500
    expect(rangeDeviation(10000, 10000, 10000, 0.15)).toEqual({ deviation: 0, tolerance: 1500 });
    expect(rangeDeviation(8000, 10000, 10000, 0.15)?.deviation).toBe(-500);
    expect(rangeDeviation(12000, 10000, 10000, 0.15)?.deviation).toBe(500);
  });

  it('is null when the plan asked for nothing', () => {
    expect(rangeDeviation(10000, 0, 0, 0.15)).toBeNull();
    expect(rangeDeviation(null, 10000, 10000, 0.15)).toBeNull();
  });
});

describe('directionFromDeviations', () => {
  it('reads all-in-band as on target', () => {
    expect(directionFromDeviations([0, 0, 0, 0])).toBe('on_target');
  });

  it('does NOT average the signs — one rep each way is mixed', () => {
    // The reason this isn't the sign of the mean: these cancel out exactly.
    expect(directionFromDeviations([-10, 10])).toBe('mixed');
    expect(directionFromDeviations([-10, 0, 10, 0])).toBe('mixed');
  });

  it('ignores in-band reps when deciding which way the rest missed', () => {
    expect(directionFromDeviations([0, -8, 0, -6])).toBe('too_fast');
    expect(directionFromDeviations([0, 7, 0, 9])).toBe('too_slow');
  });

  it('has no answer for an empty list', () => {
    expect(directionFromDeviations([])).toBeNull();
  });
});

describe('buildVerdict — the 4x2000 pair', () => {
  it('grades a runner who ran every rep to plan as on target', () => {
    const verdict = verdictFor(205, run({ distance: 13600, duration: 3400, movingDuration: 3400 }));
    expect(verdict.status).toBe('graded');
    expect(verdict.direction).toBe('on_target');
    expect(verdict.repCounts).toMatchObject({ onTarget: 4, faster: 0, slower: 0 });
    expect(verdict.paceDeviationSec).toBe(0);
    expect(verdict.score).toBe(100);
  });

  it('grades a runner who ran every rep ~13 s/km fast as too_fast', () => {
    const verdict = verdictFor(187, run({ distance: 13600, duration: 3300, movingDuration: 3300 }));
    expect(verdict.direction).toBe('too_fast');
    expect(verdict.repCounts).toMatchObject({ onTarget: 0, faster: 4, slower: 0 });
    // 187 vs a 200 band with ±5 tolerance → 8 s/km outside, negative = fast.
    expect(verdict.paceDeviationSec).toBe(-8);
    expect(verdict.score).toBeLessThan(100);
  });

  it('calls a session mixed when the reps went both ways', () => {
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    // Two reps well fast, two well slow.
    const laps = lapsAt(205);
    laps[1].averagePace = 185; laps[3].averagePace = 185;
    laps[5].averagePace = 225; laps[7].averagePace = 225;
    const verdict = buildVerdict({
      activityId: 'act-1',
      athleteId: 'ath-1',
      adherence: assessWorkout(planned, run(), DEFAULT_TOLERANCES),
      segments: matchLapsToSteps(flattenPlannedSteps(workout), laps, DEFAULT_TOLERANCES.paceSec),
    });
    expect(verdict.direction).toBe('mixed');
    expect(verdict.repCounts).toMatchObject({ faster: 2, slower: 2, onTarget: 0 });
  });

  it('shows the coach\'s pace band even though a structured session grades per rep', () => {
    const verdict = verdictFor(187, run());
    expect([verdict.paceBandMin, verdict.paceBandMax]).toEqual([200, 210]);
    const pace = verdict.metrics.find((m) => m.key === 'pace');
    // The whole-run average covers warmup + recoveries + cooldown, so it is
    // deliberately NOT graded — and it says why, rather than showing a grey blank.
    expect(pace?.status).toBe('unknown');
    expect(pace?.reason).toBe('structured_session');
  });

  it('says a duration nobody prescribed was not measured, and why', () => {
    const duration = verdictFor(205, run()).metrics.find((m) => m.key === 'duration');
    expect(duration?.status).toBe('unknown');
    expect(duration?.reason).toBe('estimated_plan');
  });

  it('weights the reps over distance/duration when it has both', () => {
    const verdict = verdictFor(187, run({ distance: 13600 }));
    expect(verdict.basis).toBe('reps_and_metrics');
    // 8 s/km outside a ±5 band → 1 - 8/15 per rep; distance is spot on.
    const repPart = 1 - 8 / (DEFAULT_TOLERANCES.paceSec * ZERO_AT_TOLERANCE_MULTIPLE);
    const expected = Math.round((REPS_WEIGHT * repPart + (1 - REPS_WEIGHT) * 1) * 100);
    expect(verdict.score).toBe(expected);
  });
});

describe('buildVerdict — runs it refuses to grade on pace', () => {
  it('falls back to distance when there are no per-rep verdicts', () => {
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    const verdict = buildVerdict({
      activityId: 'act-1',
      athleteId: 'ath-1',
      // Ran 8 km of a 13.6 km session: well under even the ±15% band.
      adherence: assessWorkout(planned, run({ distance: 8000 }), DEFAULT_TOLERANCES),
      segments: null,
    });
    expect(verdict.direction).toBe('too_short');
    expect(verdict.basis).toBe('metrics');
    expect(verdict.reps).toEqual([]);
  });

  it('gives no rep verdicts at all when the laps did not line up', () => {
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    // One lap for the whole session — a watch that was never lapped manually.
    const segments = matchLapsToSteps(
      flattenPlannedSteps(workout),
      [{ distance: 13600, duration: 3400, averagePace: 250 }],
      DEFAULT_TOLERANCES.paceSec,
    );
    const verdict = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1',
      adherence: assessWorkout(planned, run(), DEFAULT_TOLERANCES),
      segments,
    });
    expect(verdict.repsAligned).toBe(false);
    expect(verdict.repCounts.onTarget).toBe(0);
    // Never a wrong colour: unaligned laps produce no graded reps, so the score
    // can only come from the metrics.
    expect(verdict.basis).toBe('metrics');
  });

  it('treats a run with no planned workout as unplanned, not as a zero', () => {
    const verdict = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1', adherence: null, segments: null,
    });
    expect(verdict.status).toBe('unplanned');
    expect(verdict.score).toBeNull();
    expect(verdict.direction).toBe('unknown');
  });
});

describe('toExecutionSummary', () => {
  it('carries exactly what a feed ring needs', () => {
    const verdict = verdictFor(187, run());
    expect(toExecutionSummary(verdict)).toEqual({
      activityId: verdict.activityId,
      status: 'graded',
      score: verdict.score,
      direction: 'too_fast',
      workoutName: '4x2000',
    });
  });
});
