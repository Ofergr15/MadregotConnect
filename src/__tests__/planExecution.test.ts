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
import { hasStoredLaps, toLaps } from '@/lib/plan-execution/laps';
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
    expect(verdict.reps).toEqual([]);
    // But it does NOT put a percentage on it: this is a paced session and not one
    // of its paces was checked. See the `ungraded` block below.
    expect(verdict.basis).toBeNull();
    expect(verdict.score).toBeNull();
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
    // Never a wrong colour, and never a wrong number either: unaligned laps
    // produce no graded reps, and on a paced session the metrics that remain
    // cannot stand in for them.
    expect(verdict.basis).toBeNull();
    expect(verdict.score).toBeNull();
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

describe('toLaps — the two shapes stored in athlete_activities.laps', () => {
  it('passes Garmin laps through', () => {
    expect(toLaps([{ distance: 2000, duration: 410, averagePace: 205 }]))
      .toEqual([{ distance: 2000, duration: 410, averagePace: 205 }]);
  });

  it('reads a raw Strava lap, which has neither `duration` nor `averagePace`', () => {
    // The defect: these were dropped entirely, so a Strava athlete's interval
    // session had no reps and got scored on distance alone.
    const laps = toLaps([
      { name: 'Lap 1', lap_index: 1, distance: 2000, moving_time: 410, elapsed_time: 415, average_speed: 4.878 },
    ]);
    expect(laps).toHaveLength(1);
    expect(laps[0].duration).toBe(410);
    // 1000 / 4.878 m/s ≈ 205 s/km.
    expect(laps[0].averagePace).toBe(205);
  });

  it('derives pace from distance and time when neither provider gave one', () => {
    expect(toLaps([{ distance: 2000, moving_time: 410 }])[0].averagePace).toBe(205);
  });

  it('falls back to elapsed time when a lap has no moving time', () => {
    expect(toLaps([{ distance: 400, elapsed_time: 120, average_speed: 0 }])[0])
      .toEqual({ distance: 400, duration: 120, averagePace: 300 });
  });

  it('drops laps it cannot use rather than inventing a pace for them', () => {
    // A zero-distance lap would otherwise divide by zero; a lap with no time at
    // all can't be paced. Both are silently useless, never NaN.
    expect(toLaps([{ distance: 0, duration: 30 }, { distance: 1000 }, null, 'x'])).toEqual([]);
    expect(toLaps(null)).toEqual([]);
    expect(toLaps({ laps: [] })).toEqual([]);
  });

  it('tells "nobody asked" apart from "asked, and there were none"', () => {
    // `[]` is written back deliberately so the Garmin fetch happens once per run.
    expect(hasStoredLaps([])).toBe(true);
    expect(hasStoredLaps(null)).toBe(false);
    expect(hasStoredLaps(undefined)).toBe(false);
  });

  it('grades a Strava-shaped 4x2000 exactly like the Garmin-shaped one', () => {
    // The end-to-end point of the fix: same run, same verdict, either provider.
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    const stravaShaped = lapsAt(187).map((lap) => ({
      name: 'Lap', distance: lap.distance, moving_time: lap.duration,
      average_speed: 1000 / (lap.averagePace as number),
    }));
    const verdict = buildVerdict({
      activityId: 'act-1',
      athleteId: 'ath-1',
      adherence: assessWorkout(planned, run({ duration: 3300, movingDuration: 3300 }), DEFAULT_TOLERANCES),
      segments: matchLapsToSteps(
        flattenPlannedSteps(workout),
        toLaps(stravaShaped),
        DEFAULT_TOLERANCES.paceSec,
      ),
      workoutName: workout.name,
    });
    expect(verdict.direction).toBe('too_fast');
    expect(verdict.repCounts).toMatchObject({ onTarget: 0, faster: 4, slower: 0 });
    expect(verdict.score).toBe(verdictFor(187, run({ duration: 3300, movingDuration: 3300 })).score);
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

describe('buildVerdict — a paced session whose reps could not be read', () => {
  /**
   * The defect this guards: laps missing (or in a shape the reader dropped) on a
   * 4×2000 leaves distance as the only gradeable metric — and anyone who
   * finished the session covered the distance. The engine used to answer 100%
   * "executed as planned", in the ring and in the push notification, for a
   * session that may have been run entirely at the wrong pace.
   */
  function blindVerdict() {
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    return buildVerdict({
      activityId: 'act-1',
      athleteId: 'ath-1',
      adherence: assessWorkout(planned, run({ distance: 13600 }), DEFAULT_TOLERANCES),
      segments: null,
    });
  }

  it('refuses to score it at all', () => {
    const verdict = blindVerdict();
    expect(verdict.status).toBe('ungraded');
    expect(verdict.score).toBeNull();
    expect(verdict.basis).toBeNull();
  });

  it('does not claim "on target" on the strength of the distance alone', () => {
    // The distance WAS in band, and that is exactly the trap.
    const verdict = blindVerdict();
    expect(verdict.metrics.find((m) => m.key === 'distance')?.deviation).toBe(0);
    expect(verdict.direction).toBe('unknown');
  });

  it('still says so when the run also went short', () => {
    // Running 8 km of a 13.6 km session is true and worth saying without a score.
    const workout = fourByTwoK();
    const planned = buildPlannedWorkout(workout, DATE);
    const verdict = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1',
      adherence: assessWorkout(planned, run({ distance: 8000 }), DEFAULT_TOLERANCES),
      segments: null,
    });
    expect(verdict.direction).toBe('too_short');
    expect(verdict.score).toBeNull();
  });

  it('scores normally again as soon as one rep can be graded', () => {
    const verdict = verdictFor(205, run());
    expect(verdict.status).toBe('graded');
    expect(verdict.score).toBe(100);
  });

  it('leaves a continuous run alone — there the average pace IS the workout', () => {
    // No pace band prescribed per rep, so `structured_session` never applies and
    // a distance/duration score is the honest whole answer.
    const easy = {
      dayOfWeek: 1, name: 'Easy 10k',
      steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'no_target' }],
    } as ParsedWorkout;
    const verdict = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1',
      adherence: assessWorkout(
        buildPlannedWorkout(easy, DATE),
        run({ distance: 10000, duration: 3000, movingDuration: 3000 }),
        DEFAULT_TOLERANCES,
      ),
      segments: null,
    });
    expect(verdict.status).toBe('graded');
    expect(verdict.score).not.toBeNull();
  });
});
