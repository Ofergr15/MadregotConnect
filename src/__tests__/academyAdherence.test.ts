import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOLERANCES,
  assessPace,
  assessWeek,
  assessWorkout,
  buildPlannedWorkout,
  computeStepDistance,
  type ActualActivity,
  type PlannedWorkout,
} from '@/lib/academy/adherence';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The adherence engine is the plan-vs-execution scorer, and its own header says
// it takes no DB access "so it can be unit-tested" — so here are the tests. The
// cases below are mostly the ones its comments describe having gone wrong in
// production: the false 'over'/'slower' verdicts that told athletes they'd
// missed a workout they had actually hit.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    stepOrder: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { name: 'W', dayOfWeek: 0, steps, ...over } as ParsedWorkout;
}

function activity(over: Partial<ActualActivity> = {}): ActualActivity {
  return { id: 'a1', date: '2026-09-01', distance: 10_000, duration: 3000, ...over };
}

describe('computeStepDistance', () => {
  it('takes a distance step at face value', () => {
    expect(computeStepDistance(step({ durationType: 'distance', durationValue: 5000 })))
      .toEqual({ min: 5000, max: 5000 });
  });

  it('converts a timed step through its pace band, faster pace giving more distance', () => {
    // 30 min between 5:00 and 6:00/km → 5.0 km to 6.0 km.
    const d = computeStepDistance(step({
      durationType: 'time',
      durationValue: 1800,
      targetType: 'pace',
      targetPaceMinPerKm: 300,
      targetPaceMaxPerKm: 360,
    }));
    expect(d).toEqual({ min: 5000, max: 6000 });
  });

  it('multiplies a repeat block by its count', () => {
    const d = computeStepDistance(step({
      durationType: 'open',
      repeatCount: 6,
      repeatSteps: [
        step({ durationType: 'distance', durationValue: 400 }),
        step({ durationType: 'distance', durationValue: 200, type: 'rest' }),
      ],
    }));
    expect(d).toEqual({ min: 3600, max: 3600 });
  });

  it('gives an open-ended warmup a flat range rather than nothing', () => {
    expect(computeStepDistance(step({ durationType: 'open', type: 'warmup' })))
      .toEqual({ min: 1500, max: 2500 });
  });

  it('returns zero for a step it cannot size at all', () => {
    expect(computeStepDistance(step({ durationType: 'open', type: 'rest' })))
      .toEqual({ min: 0, max: 0 });
  });
});

describe('buildPlannedWorkout', () => {
  it('prefers the coach\'s explicit km over summing the steps', () => {
    const p = buildPlannedWorkout(
      workout([step({ durationValue: 1000 })], { distanceMinKm: 12, distanceMaxKm: 14 }),
      '2026-09-01',
    );
    expect(p.distanceMin).toBe(12_000);
    expect(p.distanceMax).toBe(14_000);
  });

  it('mirrors a single explicit distance into both bounds', () => {
    const p = buildPlannedWorkout(workout([step()], { distanceMinKm: 10 }), '2026-09-01');
    expect(p.distanceMin).toBe(10_000);
    expect(p.distanceMax).toBe(10_000);
  });

  it('marks duration estimated when a distance step carries no pace to convert it', () => {
    const p = buildPlannedWorkout(workout([step({ durationValue: 10_000 })]), '2026-09-01');
    expect(p.durationEstimated).toBe(true);
  });

  it('keeps duration exact when every step states its own time', () => {
    const p = buildPlannedWorkout(
      workout([step({ durationType: 'time', durationValue: 1800 })]),
      '2026-09-01',
    );
    expect(p.durationSec).toBe(1800);
    expect(p.durationEstimated).toBe(false);
  });

  it('treats a workout with nothing timed at all as estimated', () => {
    const p = buildPlannedWorkout(workout([step({ durationType: 'open', type: 'rest' })]), '2026-09-01');
    expect(p.durationSec).toBe(90);
    expect(p.durationEstimated).toBe(true);
  });

  // ── The regression this file's comments are about ────────────────────────────
  it('does not report an exact planned time for a session whose rests are open-ended', () => {
    // 2 km warmup at 6:00, then 6×(400 m at 4:00 + Lap Button Press rest), then
    // a 1 km cooldown at 6:00 — the ordinary way an interval workout is written.
    const p = buildPlannedWorkout(workout([
      step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 360, targetPaceMaxPerKm: 360 }),
      step({
        durationType: 'open',
        repeatCount: 6,
        repeatSteps: [
          step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 }),
          step({ type: 'rest', durationType: 'open' }),
        ],
      }),
      step({ type: 'cooldown', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 360, targetPaceMaxPerKm: 360 }),
    ]), '2026-09-01');

    // The rests are unbounded, so the planned total cannot be a graded figure.
    expect(p.durationEstimated).toBe(true);

    // And the athlete who ran the session in 34 minutes is not marked 'over':
    // an estimated duration is never graded.
    const a = assessWorkout(p, activity({ distance: 5400, duration: 2040, movingDuration: 2040 }));
    expect(a.duration.status).toBe('unknown');
    expect(a.duration.estimated).toBe(true);
  });
});

describe('assessPace', () => {
  it('allows the tolerance in seconds per km on both sides of the band', () => {
    // A 5:00 target on the default paceSec=10 is good from 4:50 to 5:10.
    expect(assessPace(300, 300, 300)).toBe('on_target');
    expect(assessPace(290, 300, 300)).toBe('on_target');
    expect(assessPace(310, 300, 300)).toBe('on_target');
    expect(assessPace(289, 300, 300)).toBe('faster');
    expect(assessPace(311, 300, 300)).toBe('slower');
    // And the caller's own tolerance still wins over the default.
    expect(assessPace(294, 300, 300, 5)).toBe('faster');
    expect(assessPace(306, 300, 300, 5)).toBe('slower');
  });

  it('is unknown without both an actual and a band', () => {
    expect(assessPace(null, 300, 300)).toBe('unknown');
    expect(assessPace(300, undefined, 300)).toBe('unknown');
    expect(assessPace(300, 300, undefined)).toBe('unknown');
  });
});

describe('assessWorkout — pace is graded only when one band covers the session', () => {
  it('grades a continuous run, where the average IS the prescription', () => {
    const p = buildPlannedWorkout(
      workout([step({ durationValue: 10_000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 310 })]),
      '2026-09-01',
    );
    expect(p.gradedPaceMin).toBe(300);
    const a = assessWorkout(p, activity({ distance: 10_000, averagePace: 305 }));
    expect(a.pace.status).toBe('on_target');
  });

  it('refuses to grade a structured session against one whole-run average', () => {
    // The measured production bug: a 2 km warmup at 5:30 plus 8×400 m at 4:00 has
    // a whole-run average nowhere near 4:00, and 139 of 307 real sessions were
    // reported "slower than target" because of it.
    const p = buildPlannedWorkout(workout([
      step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 330 }),
      step({
        durationType: 'open',
        repeatCount: 8,
        repeatSteps: [step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 })],
      }),
    ]), '2026-09-01');

    // The work band is still reported — it's what the athlete is shown.
    expect(p.paceMin).toBe(240);
    // But there is no band to grade a single average against.
    expect(p.gradedPaceMin).toBeUndefined();

    const a = assessWorkout(p, activity({ distance: 5200, averagePace: 290 }));
    expect(a.pace.status).toBe('unknown');
    expect(a.pace.plannedMin).toBe(240); // shown
    expect(a.pace.comparedMin).toBeNull(); // not judged
  });
});

describe('assessWorkout — scoring', () => {
  const planned: PlannedWorkout = {
    date: '2026-09-01',
    name: 'Easy 10k',
    distanceMin: 10_000,
    distanceMax: 10_000,
    durationSec: 3000,
    durationEstimated: false,
    gradedPaceMin: 300,
    gradedPaceMax: 300,
    paceMin: 300,
    paceMax: 300,
  };

  it('scores a workout that hit all three metrics', () => {
    const a = assessWorkout(planned, activity({ distance: 10_000, movingDuration: 3000, averagePace: 300 }));
    expect(a.completed).toBe(true);
    expect(a.score).toBe(1);
  });

  it('scores the fraction of metrics on target', () => {
    // Distance and pace good, duration well over → 2 of 3.
    const a = assessWorkout(planned, activity({ distance: 10_000, movingDuration: 4200, averagePace: 300 }));
    expect(a.duration.status).toBe('over');
    expect(a.score).toBeCloseTo(2 / 3);
  });

  it('scores a missed workout zero, not unknown', () => {
    const a = assessWorkout(planned, null);
    expect(a.completed).toBe(false);
    expect(a.score).toBe(0);
  });

  it('gives full credit when the plan left nothing gradable', () => {
    // Deliberate: an athlete who ran isn't penalised for gaps in the plan's own
    // data. Nothing is measurable here, so there is nothing to fall short of.
    const bare: PlannedWorkout = {
      date: '2026-09-01', name: 'Run', distanceMin: 0, distanceMax: 0,
      durationSec: 0, durationEstimated: true,
    };
    const a = assessWorkout(bare, activity());
    expect(a.score).toBe(1);
    expect(a.distance.status).toBe('unknown');
  });

  it('prefers moving time over elapsed time', () => {
    const a = assessWorkout(planned, activity({ duration: 5400, movingDuration: 3000 }));
    expect(a.duration.actual).toBe(3000);
    expect(a.duration.status).toBe('on_target');
  });

  it('falls back to elapsed time when moving time is absent', () => {
    const a = assessWorkout(planned, activity({ duration: 3000, movingDuration: null }));
    expect(a.duration.actual).toBe(3000);
  });

  it('applies the distance tolerance at both edges', () => {
    // ±15% of 10 km → 8.5 to 11.5 km.
    expect(assessWorkout(planned, activity({ distance: 8500 })).distance.status).toBe('on_target');
    expect(assessWorkout(planned, activity({ distance: 11_500 })).distance.status).toBe('on_target');
    expect(assessWorkout(planned, activity({ distance: 8400 })).distance.status).toBe('under');
    expect(assessWorkout(planned, activity({ distance: 11_600 })).distance.status).toBe('over');
  });

  it('honours a caller\'s own tolerances', () => {
    const strict = { ...DEFAULT_TOLERANCES, distance: 0 };
    expect(assessWorkout(planned, activity({ distance: 9000 }), strict).distance.status).toBe('under');
  });
});

describe('assessWeek', () => {
  const plan = (date: string, key: string, name = key): PlannedWorkout => ({
    date, name, workoutKey: key,
    distanceMin: 10_000, distanceMax: 10_000,
    durationSec: 3000, durationEstimated: true,
  });

  it('rolls up completion and the average score across planned workouts', () => {
    const week = assessWeek(
      [plan('2026-09-01', 'a'), plan('2026-09-03', 'b'), plan('2026-09-05', 'c')],
      [activity({ id: 'x', date: '2026-09-01', distance: 10_000 })],
    );
    expect(week.plannedCount).toBe(3);
    expect(week.completedCount).toBe(1);
    expect(week.completionRate).toBeCloseTo(1 / 3);
    expect(week.avgScore).toBeCloseTo(1 / 3); // one perfect, two missed
  });

  it('is empty rather than dividing by zero when nothing was planned', () => {
    const week = assessWeek([], [activity()]);
    expect(week).toMatchObject({ plannedCount: 0, completedCount: 0, completionRate: 0, avgScore: 0 });
  });

  it('never counts one activity towards two planned workouts', () => {
    const week = assessWeek(
      [plan('2026-09-01', 'a'), plan('2026-09-01', 'b')],
      [activity({ id: 'only', date: '2026-09-01' })],
    );
    expect(week.completedCount).toBe(1);
  });

  it('picks the same-day activity closest to the planned distance', () => {
    const week = assessWeek(
      [plan('2026-09-01', 'a')],
      [
        activity({ id: 'short', date: '2026-09-01', distance: 3000 }),
        activity({ id: 'right', date: '2026-09-01', distance: 9800 }),
        activity({ id: 'long', date: '2026-09-01', distance: 21_000 }),
      ],
    );
    expect(week.workouts[0].actual?.id).toBe('right');
  });

  it('picks the longest same-day activity when the plan states no distance', () => {
    const noDistance: PlannedWorkout = {
      date: '2026-09-01', name: 'Run', distanceMin: 0, distanceMax: 0,
      durationSec: 0, durationEstimated: true,
    };
    const week = assessWeek([noDistance], [
      activity({ id: 'short', date: '2026-09-01', distance: 3000 }),
      activity({ id: 'long', date: '2026-09-01', distance: 12_000 }),
    ]);
    expect(week.workouts[0].actual?.id).toBe('long');
  });

  // ── Attribution: the whole point of the `attribution` argument ──────────────
  it('credits a session the matcher moved to another day', () => {
    // Coach planned Tuesday; the athlete ran it Wednesday and the matcher (or the
    // coach, by hand) attributed it. By date alone this was a missed workout.
    const week = assessWeek(
      [plan('2026-09-01', 'tue')],
      [activity({ id: 'ran-wed', date: '2026-09-02', distance: 10_000 })],
      DEFAULT_TOLERANCES,
      new Map([['tue', ['ran-wed']]]),
    );
    expect(week.completedCount).toBe(1);
    expect(week.workouts[0].actual?.id).toBe('ran-wed');
  });

  it('lets an attributed workout claim its activity before any same-day pick can', () => {
    // Both planned sessions sit on the 1st, and there is one activity, which the
    // matcher gave to the SECOND of them. Array order must not let the first
    // steal it.
    const week = assessWeek(
      [plan('2026-09-01', 'first'), plan('2026-09-01', 'second')],
      [activity({ id: 'the-run', date: '2026-09-01' })],
      DEFAULT_TOLERANCES,
      new Map([['second', ['the-run']]]),
    );
    expect(week.workouts[0].actual).toBeNull();
    expect(week.workouts[1].actual?.id).toBe('the-run');
  });

  it('falls back to the same-day pick for days the attribution says nothing about', () => {
    // An unmigrated activity_plan_matches, or an athlete synced before matching
    // ran, must degrade to the old behaviour — not report an empty week.
    const week = assessWeek(
      [plan('2026-09-01', 'matched'), plan('2026-09-03', 'unmatched')],
      [
        activity({ id: 'm', date: '2026-09-01' }),
        activity({ id: 'u', date: '2026-09-03' }),
      ],
      DEFAULT_TOLERANCES,
      new Map([['matched', ['m']]]),
    );
    expect(week.completedCount).toBe(2);
    expect(week.workouts[1].actual?.id).toBe('u');
  });

  it('ignores an attribution pointing at an activity that is not in the window', () => {
    const week = assessWeek(
      [plan('2026-09-01', 'a')],
      [activity({ id: 'present', date: '2026-09-01' })],
      DEFAULT_TOLERANCES,
      new Map([['a', ['absent']]]),
    );
    // Falls through to the same-day pick rather than reporting a miss.
    expect(week.workouts[0].actual?.id).toBe('present');
  });
});
