import { describe, expect, it } from 'vitest';
import type { MetricStatus, PaceStatus } from '@/lib/academy/adherence';
import type { EffortReport } from '@/lib/academy/segments';
import { exceededPlan, verdictLevel, type PlanVerdict } from '@/lib/academy/verdict';

function verdict(over: {
  distance?: MetricStatus;
  duration?: MetricStatus;
  pace?: PaceStatus;
  estimated?: boolean;
  efforts?: EffortReport | null;
}): PlanVerdict {
  return {
    workoutName: 'Session',
    date: '2026-09-06',
    activityId: 'act-1',
    distance: {
      status: over.distance ?? 'unknown',
      plannedMin: 10000, plannedMax: 11000, actual: 10400, pct: 1.0,
    },
    duration: {
      status: over.duration ?? 'unknown',
      planned: 3000, actual: 3050, pct: 1.0, estimated: over.estimated ?? false,
    },
    pace: {
      status: over.pace ?? 'unknown',
      plannedMin: 280, plannedMax: 290, comparedMin: 280, comparedMax: 290, actual: 285,
    },
    score: 0,
    efforts: over.efforts ?? null,
  };
}

function efforts(partial: Partial<EffortReport>): EffortReport {
  return {
    verdict: 'unverifiable',
    requirements: [],
    neededTotal: 0,
    attemptedTotal: 0,
    foundTotal: 0,
    lapCount: 0,
    medianLapM: null,
    ...partial,
  };
}

describe('verdictLevel', () => {
  it('is on_plan when every gradeable metric is on target', () => {
    expect(verdictLevel(verdict({ distance: 'on_target', pace: 'on_target' }))).toBe('on_plan');
  });

  it('is partly when some metrics are on target and some are not', () => {
    expect(verdictLevel(verdict({ distance: 'on_target', pace: 'slower' }))).toBe('partly');
  });

  it('is off_plan when nothing gradeable was on target', () => {
    expect(verdictLevel(verdict({ distance: 'under', pace: 'slower' }))).toBe('off_plan');
  });

  // A run with no plan-comparable numbers must not be graded at all. This is what
  // keeps the card off the screen instead of showing three dashes.
  it('is unknown when nothing could be graded', () => {
    expect(verdictLevel(verdict({}))).toBe('unknown');
  });

  it('ignores an ungraded metric rather than counting it against the run', () => {
    // Duration is 'unknown' because the plan never stated a time — see assessWorkout.
    const level = verdictLevel(verdict({ distance: 'on_target', pace: 'on_target', estimated: true }));
    expect(level).toBe('on_plan');
  });

  // The whole point of the effort check: 12 km of easy running can put DISTANCE on
  // target for a day that asked for 6x400, and only the laps show the reps.
  it('lets a confirmed effort check overrule the whole-run metrics', () => {
    const level = verdictLevel(verdict({
      distance: 'under', pace: 'slower',
      efforts: efforts({ verdict: 'confirmed', neededTotal: 6, attemptedTotal: 6, foundTotal: 6 }),
    }));
    expect(level).toBe('on_plan');
  });

  it('calls a session off_plan when the reps were not run, however the totals look', () => {
    const level = verdictLevel(verdict({
      distance: 'on_target', pace: 'on_target',
      efforts: efforts({ verdict: 'missed', neededTotal: 6, attemptedTotal: 0, foundTotal: 0 }),
    }));
    expect(level).toBe('off_plan');
  });

  it('is partly when some reps were run at target pace', () => {
    const level = verdictLevel(verdict({
      distance: 'on_target', pace: 'on_target',
      efforts: efforts({ verdict: 'partial', neededTotal: 6, attemptedTotal: 6, foundTotal: 4 }),
    }));
    expect(level).toBe('partly');
  });

  // An unverifiable effort check means "the laps can't answer", NOT "the reps
  // weren't there" — it must fall through to the whole-run metrics, which is the
  // case for every athlete on automatic 1 km laps.
  it('falls back to the whole-run metrics when the laps cannot answer', () => {
    const level = verdictLevel(verdict({
      distance: 'on_target', pace: 'on_target',
      efforts: efforts({ verdict: 'unverifiable', reason: 'laps_too_coarse', medianLapM: 1000 }),
    }));
    expect(level).toBe('on_plan');
  });
});

describe('exceededPlan', () => {
  it('is true for further than asked', () => {
    expect(exceededPlan('over', 'on_target')).toBe(true);
  });

  it('is true for faster than asked', () => {
    expect(exceededPlan('on_target', 'faster')).toBe(true);
  });

  it('is true for further AND faster', () => {
    expect(exceededPlan('over', 'faster')).toBe(true);
  });

  // Mixed is not "did more" — cutting the distance and jogging the rest is a
  // different run, and it keeps the plain off-plan colour.
  it('is false when anything came up short or slow', () => {
    expect(exceededPlan('over', 'slower')).toBe(false);
    expect(exceededPlan('under', 'faster')).toBe(false);
  });

  it('is false when nothing went over', () => {
    expect(exceededPlan('on_target', 'on_target')).toBe(false);
    expect(exceededPlan('under', 'slower')).toBe(false);
    expect(exceededPlan('unknown', 'unknown')).toBe(false);
  });
});
