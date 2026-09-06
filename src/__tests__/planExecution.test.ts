import { describe, it, expect } from 'vitest';
import {
  buildVerdict,
  closeness,
  directionFromDeviations,
  paceDeviation,
  planGap,
  rangeDeviation,
  toExecutionSummary,
  REPS_WEIGHT,
  ZERO_AT_TOLERANCE_MULTIPLE,
  type ExecutionMetric,
} from '@/lib/plan-execution/verdict';
import {
  assessWorkout,
  buildPlannedWorkout,
  DEFAULT_TOLERANCES,
  type ActualActivity,
} from '@/lib/academy/adherence';
import {
  flattenPlannedSteps,
  matchLapsToSteps,
  type Lap,
  type PlannedKmPoint,
} from '@/lib/academy/segments';
import { hasStoredLaps, toLaps } from '@/lib/plan-execution/laps';
import { segmentReportFor } from '@/lib/plan-execution/resolve';
import { executionTakesPaceChart, workRepsOf } from '@/components/activity/ExecutionQuality';
import type { Split } from '@/components/activity/types';
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

describe('planGap — the number the athlete is actually told', () => {
  const distanceMetric = (actual: number | null): ExecutionMetric => ({
    key: 'distance',
    status: 'under',
    actual,
    plannedMin: 23000,
    plannedMax: 23000,
    closeness: 0,
    deviation: null,
    reason: null,
  });

  it('measures from the plan, not from the tolerated edge', () => {
    // The bug on screen: 15.0 km against a 23 km plan was reported as "shorter by
    // 4.5 km" — that's the miss beyond the ±15% tolerance (19,550), a number that
    // appears neither in the run nor in the plan. The athlete was 8 km short.
    expect(planGap(distanceMetric(15009))).toBe(15009 - 23000);
    expect(rangeDeviation(15009, 23000, 23000, 0.15)?.deviation).toBe(15009 - 19550);
  });

  it('is zero anywhere inside the plan’s own band, and signed outside it', () => {
    const ranged = (actual: number): ExecutionMetric => ({
      ...distanceMetric(actual), plannedMin: 10000, plannedMax: 12000,
    });
    expect(planGap(ranged(10000))).toBe(0);
    expect(planGap(ranged(11000))).toBe(0);
    expect(planGap(ranged(12000))).toBe(0);
    expect(planGap(ranged(9000))).toBe(-1000);
    expect(planGap(ranged(13000))).toBe(1000);
  });

  it('has no answer when either side of the comparison is missing', () => {
    expect(planGap(distanceMetric(null))).toBeNull();
    expect(planGap({ ...distanceMetric(15009), plannedMin: null })).toBeNull();
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

  it('blames the plan, not the watch, when no pace was ever prescribed', () => {
    // An easy run: the plan asked for 10 km and said nothing about pace. The
    // recorded pace is right there in the same row, so "the run has no such
    // value" would be a lie the athlete can see.
    const easy = {
      dayOfWeek: 1, name: 'easy 10k',
      steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'no_target' }],
    } as ParsedWorkout;
    const verdict = buildVerdict({
      activityId: 'act-1',
      athleteId: 'ath-1',
      adherence: assessWorkout(
        buildPlannedWorkout(easy, DATE),
        run({ distance: 10200, duration: 3060, movingDuration: 3060, averagePace: 300 }),
        DEFAULT_TOLERANCES,
      ),
      segments: null,
    });
    const pace = verdict.metrics.find((m) => m.key === 'pace');
    expect(pace?.actual).toBe(300);
    expect(pace?.status).toBe('unknown');
    expect(pace?.reason).toBe('no_plan_value');
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
    // The distance WAS in band, and that is exactly the trap. A scorer that falls
    // back to "every gradeable whole-run metric is on target" puts a green "on
    // plan" on a 4×2000 run at entirely the wrong pace — on the club feed, where
    // it is the first thing the athlete and their coach read. One did.
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

/**
 * Which evidence the accuracy card is allowed to draw.
 *
 * A pure predicate, but the one that decides whether a runner sees a chart at all,
 * and every `false` below is a render that was wrong on screen before it existed:
 * a km grid laid over reps and recovery jogs, an axis with an empty band behind it,
 * the same chart twice on one page.
 */
describe('executionTakesPaceChart', () => {
  const splits: Split[] = Array(10).fill(0).map(() => ({
    distance: 1000, duration: 300, averagePace: 300, averageHR: null, elevationGain: null,
  }));
  const overlay: (PlannedKmPoint | null)[] = splits.map(() => ({ pace: 295, min: 290, max: 300 }));

  /** A continuous run: paced, but with no reps the engine could grade. */
  function continuousVerdict() {
    const steady = {
      dayOfWeek: 1, name: 'Tempo 10k',
      steps: [{
        order: 1, type: 'active', durationType: 'distance', durationValue: 10000,
        targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300,
      }],
    } as ParsedWorkout;
    return buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1',
      adherence: assessWorkout(
        buildPlannedWorkout(steady, DATE),
        run({ distance: 10000, duration: 3000, movingDuration: 3000, averagePace: 300 }),
        DEFAULT_TOLERANCES,
      ),
      segments: null,
      workoutName: steady.name,
    });
  }

  it('draws the kilometres for a continuous run — its only other evidence is one average', () => {
    expect(executionTakesPaceChart(continuousVerdict(), splits, overlay, true)).toBe(true);
  });

  it('yields to the rep chart when the reps were readable', () => {
    // Even told the plan is continuous: gradeable reps answer the same question
    // more sharply, and two charts stacked on one card is the third label problem.
    expect(executionTakesPaceChart(verdictFor(205, run()), splits, overlay, true)).toBe(false);
  });

  it('refuses an interval plan — `isContinuousPlan` already said the frame lies', () => {
    expect(executionTakesPaceChart(continuousVerdict(), splits, overlay, false)).toBe(false);
  });

  it('refuses an unplanned run — there is no plan to draw behind the line', () => {
    const unplanned = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1', adherence: null, segments: null,
    });
    expect(unplanned.status).toBe('unplanned');
    expect(executionTakesPaceChart(unplanned, splits, overlay, true)).toBe(false);
  });

  it('refuses an all-null overlay — a chart with nothing to compare against', () => {
    expect(executionTakesPaceChart(continuousVerdict(), splits, splits.map(() => null), true)).toBe(false);
    expect(executionTakesPaceChart(continuousVerdict(), splits, null, true)).toBe(false);
  });

  it('refuses a single split — one point is not a line', () => {
    expect(executionTakesPaceChart(continuousVerdict(), splits.slice(0, 1), overlay, true)).toBe(false);
    expect(executionTakesPaceChart(continuousVerdict(), undefined, overlay, true)).toBe(false);
  });

  it('refuses when the verdict has not loaded yet', () => {
    expect(executionTakesPaceChart(null, splits, overlay, true)).toBe(false);
  });
});

/**
 * The seam the coach's roll-up shares with the athlete's own run page.
 *
 * The academy compliance table reaches its verdicts from the other direction — it
 * already holds the week's adherence rows from `assessWeek` and borrows only the
 * rep matching from here. If these two ever disagreed about which reps counted,
 * the coach and the athlete would read different percentages for the same run and
 * the coach would be the last to find out.
 */
describe('segmentReportFor', () => {
  it('grades exactly the paced reps, not the warmup, cooldown or recoveries', () => {
    const report = segmentReportFor(fourByTwoK(), lapsAt(205), DEFAULT_TOLERANCES.paceSec);
    expect(report).not.toBeNull();
    expect(report!.segments.filter(s => s.graded).length).toBe(4);
    expect(report!.gradedCount).toBe(4);
    expect(report!.onTargetCount).toBe(4);
  });

  it('returns null when there are no laps to read, rather than an empty report', () => {
    // Load-bearing: `buildVerdict` treats a null report on a paced session as
    // "asked but unmeasured" and refuses to score it, where an empty one would
    // look like a session with nothing gradeable in it and fall back to grading
    // the whole-run distance — a confident number for a run nobody measured.
    expect(segmentReportFor(fourByTwoK(), [], DEFAULT_TOLERANCES.paceSec)).toBeNull();
  });

  it('reaches the same verdict from a stored lap blob as the run page does', () => {
    // The roll-up's laps come out of `athlete_activities.laps` through `toLaps`,
    // never from Garmin. Same reps, same score, whichever side asked.
    const stored = lapsAt(187).map(l => ({
      distance: l.distance, moving_time: l.duration, average_speed: 1000 / l.averagePace!,
    }));
    const workout = fourByTwoK();
    const adherence = assessWorkout(buildPlannedWorkout(workout, DATE), run(), DEFAULT_TOLERANCES);
    const fromStore = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1', adherence, workoutName: workout.name,
      segments: segmentReportFor(workout, toLaps(stored), DEFAULT_TOLERANCES.paceSec),
    });
    const fromRunPage = verdictFor(187, run());
    expect(fromStore.score).toBe(fromRunPage.score);
    expect(fromStore.direction).toBe(fromRunPage.direction);
  });
});

/**
 * Which segments the "rep after rep" section is about.
 *
 * A coach who writes "2 km warmup at 5:30–5:50" has prescribed a pace, so the
 * warmup arrives as a GRADED segment — indistinguishable, to everything
 * downstream, from one of the four 2000s. It got counted as a rep, and the card
 * then described a 4×2000 four different ways at once: a list of six "reps" headed
 * "target 4:25–4:32" with a 5:40 warmup marked in-range against it, a deviation
 * axis whose marker was the mean of all six (4:49 — pinned at the far SLOW end)
 * under a headline reading "you ran faster than planned", and a count of 5 of 6.
 *
 * Every one of those numbers was real. They just described different segments to
 * each other, which is the failure mode this whole feature exists to avoid, and no
 * test caught it because the fixture above leaves the warmup unpaced.
 */
describe('workRepsOf', () => {
  /** The 4×2000, with the warmup and cooldown paced the way a coach writes them. */
  function pacedEnds(): ParsedWorkout {
    const workout = fourByTwoK();
    const ends = { targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 350 };
    return {
      ...workout,
      steps: [
        { ...workout.steps[0], ...ends },
        workout.steps[1],
        { ...workout.steps[2], ...ends },
      ] as WorkoutStep[],
    } as ParsedWorkout;
  }

  /**
   * One rep run past the tolerance, the rest in band, warmup and cooldown to plan.
   * The band is 200–210 and the tolerance 5, so 192 is the first pace that counts
   * as faster rather than close enough.
   */
  function repsOfPacedEnds() {
    const workout = pacedEnds();
    const laps = lapsAt(205);
    laps[1] = { distance: 2000, duration: 2000 * (192 / 1000), averagePace: 192 };
    const verdict = buildVerdict({
      activityId: 'act-1', athleteId: 'ath-1', workoutName: workout.name,
      adherence: assessWorkout(buildPlannedWorkout(workout, DATE), run(), DEFAULT_TOLERANCES),
      segments: matchLapsToSteps(flattenPlannedSteps(workout), laps, DEFAULT_TOLERANCES.paceSec),
    });
    return verdict.reps.filter((rep) => rep.graded && rep.actualPace != null && rep.status !== 'unknown');
  }

  it('keeps the four reps and drops the warmup and the cooldown', () => {
    const graded = repsOfPacedEnds();
    // The engine grades all six: that is not wrong, it is just not a rep list.
    expect(graded).toHaveLength(6);
    expect(workRepsOf(graded).map((rep) => rep.type)).toEqual(Array(4).fill('interval'));
  });

  it('leaves the mean on the side of the band the headline claims', () => {
    const work = workRepsOf(repsOfPacedEnds());
    const mean = work.reduce((sum, rep) => sum + (rep.actualPace as number), 0) / work.length;
    // The work band is 200–210. Including the 5:00/km ends put this at 245.
    expect(mean).toBeLessThan(210);
  });

  it('counts only the reps, so "n of m in range" matches the rows on screen', () => {
    const work = workRepsOf(repsOfPacedEnds());
    expect(work.filter((rep) => rep.status === 'on_target')).toHaveLength(3);
    expect(work).toHaveLength(4);
  });

  it('keeps what there is when the warmup and cooldown are all the plan paced', () => {
    // Nothing to show beats an empty section: the athlete still ran something the
    // coach put a pace on.
    const workout = pacedEnds();
    const ends = flattenPlannedSteps(workout).filter((seg) => seg.type !== 'interval');
    expect(ends.length).toBeGreaterThan(0);
    const onlyEnds = repsOfPacedEnds().filter((rep) => rep.type !== 'interval');
    expect(workRepsOf(onlyEnds)).toEqual(onlyEnds);
  });
});
