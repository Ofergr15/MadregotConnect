import { describe, it, expect } from 'vitest';
import { normalizeParsedWorkouts, normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { sessionKind } from '@/lib/plans/session-label';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The matcher-hint stamper. `activity-matcher.ts` rejects a keyless workout
// outright, and this module's header records what that cost in production: 119 of
// 140 published workouts had no `workoutKey`, so 1139 of 1188 recorded activities
// (96%) could never be attributed to the workout they were run for.
//
// The fix was to normalize on READ as well as on write, with no backfill
// migration — which is only safe because the keys are deterministic. That claim
// is the most load-bearing thing in the file, so it is the first thing tested
// here: a plan normalized lazily today has to get exactly the keys it would have
// got at publish time, or every persisted match starts pointing at the wrong
// workout.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { dayOfWeek: 0, name: 'Run', steps: [step()], ...over } as ParsedWorkout;
}

describe('normalizeWorkoutParts — keys', () => {
  it('stamps the documented key shape', () => {
    const [w] = normalizeWorkoutParts({ workouts: [workout({ dayOfWeek: 2 })] }).workouts;
    expect(w.workoutKey).toBe('day-2-part-1-single');
  });

  it('gives the same key on a second pass, which is what makes normalize-on-read safe', () => {
    const plan = {
      workouts: [
        workout({ dayOfWeek: 2, name: 'Warmup', steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: '3000 test' }),
        workout({ dayOfWeek: 4, name: 'Easy' }),
      ],
    };
    const once = normalizeWorkoutParts(plan);
    const twice = normalizeWorkoutParts(once);
    expect(twice.workouts.map(w => w.workoutKey)).toEqual(once.workouts.map(w => w.workoutKey));
    // And it is genuinely idempotent, not just key-stable.
    expect(twice).toEqual(once);
  });

  it('numbers the parts of one day in the order they are listed', () => {
    const out = normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 2, name: 'Warmup', steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: 'Main set' }),
        workout({ dayOfWeek: 2, name: 'Cooldown', steps: [step({ type: 'cooldown' })] }),
      ],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([1, 2, 3]);
    expect(out.every(w => w.partCount === 3)).toBe(true);
    expect(out.map(w => w.workoutKey)).toEqual([
      'day-2-part-1-warmup',
      'day-2-part-2-main',
      'day-2-part-3-cooldown',
    ]);
  });

  it('counts parts per day, not across the week', () => {
    const out = normalizeWorkoutParts({
      workouts: [workout({ dayOfWeek: 1 }), workout({ dayOfWeek: 1 }), workout({ dayOfWeek: 3 })],
    }).workouts;
    expect(out.map(w => w.partCount)).toEqual([2, 2, 1]);
  });

  it('produces distinct keys for every workout of a full week', () => {
    // A duplicate key is worse than a missing one: two workouts would answer to
    // the same match row.
    const out = normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 0 }),
        workout({ dayOfWeek: 2, name: 'Warmup', steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: 'Intervals' }),
        workout({ dayOfWeek: 2, name: 'Cooldown', steps: [step({ type: 'cooldown' })] }),
        workout({ dayOfWeek: 5 }),
      ],
    }).workouts;
    expect(new Set(out.map(w => w.workoutKey)).size).toBe(out.length);
  });

  it('keeps a partIndex the caller supplied', () => {
    const [w] = normalizeWorkoutParts({ workouts: [workout({ dayOfWeek: 1, partIndex: 3 })] }).workouts;
    expect(w.partIndex).toBe(3);
    expect(w.workoutKey).toBe('day-1-part-3-single');
  });

  it('keeps a supplied numbering that is out of order but still unique', () => {
    const out = normalizeWorkoutParts({
      workouts: [workout({ dayOfWeek: 1, partIndex: 2 }), workout({ dayOfWeek: 1, partIndex: 1 })],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([2, 1]);
  });

  // ── Where a supplied index is not trustworthy ──────────────────────────────
  it('renumbers a day whose supplied indices collide', () => {
    // partIndex reaches this function from the model (see lib/ai/prompt.ts), and
    // it goes straight into workoutKey — so "2, 2" for a two-part day would give
    // both workouts the same key and each other's matches.
    const out = normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 2, name: 'Warmup', partIndex: 2, steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: 'Main', partIndex: 2 }),
      ],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([1, 2]);
    expect(new Set(out.map(w => w.workoutKey)).size).toBe(2);
  });

  it('renumbers a day where only some parts carry an index', () => {
    // 1 supplied on the second part plus an inferred 1 on the first is the same
    // collision arriving from the other direction.
    const out = normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 2, name: 'Warmup', steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: 'Main', partIndex: 1 }),
      ],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([1, 2]);
  });

  it('renumbers a day whose supplied index is not a positive number', () => {
    const out = normalizeWorkoutParts({
      workouts: [workout({ dayOfWeek: 2, partIndex: 0 }), workout({ dayOfWeek: 2, partIndex: -1 })],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([1, 2]);
  });

  it('renumbers only the day that is wrong', () => {
    const out = normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 1, partIndex: 5 }),
        workout({ dayOfWeek: 3, partIndex: 2 }),
        workout({ dayOfWeek: 3, partIndex: 2 }),
      ],
    }).workouts;
    expect(out.map(w => w.partIndex)).toEqual([5, 1, 2]);
  });

  it('is still idempotent after renumbering a bad day', () => {
    // The whole normalize-on-read design rests on this: the repaired numbering
    // has to survive a second pass unchanged.
    const plan = {
      workouts: [
        workout({ dayOfWeek: 2, name: 'Warmup', partIndex: 2, steps: [step({ type: 'warmup' })] }),
        workout({ dayOfWeek: 2, name: 'Main', partIndex: 2 }),
      ],
    };
    const once = normalizeWorkoutParts(plan);
    expect(normalizeWorkoutParts(once)).toEqual(once);
  });
});

describe('normalizeWorkoutParts — partKind', () => {
  const kind = (w: Partial<ParsedWorkout>, siblings = 0) =>
    normalizeWorkoutParts({
      workouts: [
        workout({ dayOfWeek: 2, ...w }),
        ...Array.from({ length: siblings }, () => workout({ dayOfWeek: 2, name: 'other' })),
      ],
    }).workouts[0].partKind;

  it('calls a day with one workout "single", whatever it is named', () => {
    // The partCount check runs before the name check on purpose: a lone workout
    // has no other part to be the main set of.
    expect(kind({ name: '3000 test' })).toBe('single');
  });

  it('recognises a test part by name, in Hebrew or English', () => {
    expect(kind({ name: 'מבחן 3000' }, 1)).toBe('test');
    expect(kind({ name: 'Time trial' }, 1)).toBe('test');
    expect(kind({ name: 'Race pace' }, 1)).toBe('test');
    expect(kind({ name: 'Easy', description: '3000 מבחן' }, 1)).toBe('test');
  });

  it('reads a part made only of warmup steps as the warmup', () => {
    expect(kind({ name: 'Part 1', steps: [step({ type: 'warmup' }), step({ type: 'warmup' })] }, 1))
      .toBe('warmup');
  });

  it('reads a part made of cooldown and recovery steps as the cooldown', () => {
    expect(kind({ name: 'Part 3', steps: [step({ type: 'cooldown' }), step({ type: 'recovery' })] }, 1))
      .toBe('cooldown');
  });

  it('falls back to "main" for a mixed part', () => {
    expect(kind({ name: 'Part 2', steps: [step({ type: 'warmup' }), step({ type: 'interval' })] }, 1))
      .toBe('main');
  });

  it('trusts a partKind the caller already set', () => {
    expect(kind({ name: 'Part 2', partKind: 'test' }, 1)).toBe('test');
  });

  // ── Two sessions in one day ────────────────────────────────────────────────
  // The week this was written, Tuesday held a morning run and an evening run and
  // the app showed one merged workout. Naming the axis the day was split on is
  // what makes the second session readable instead of "part 2".
  it('names a morning and an evening session, in Hebrew or English', () => {
    expect(kind({ name: 'בוקר - 8 ק״מ' }, 1)).toBe('morning');
    expect(kind({ name: 'ערב - 6 ק״מ' }, 1)).toBe('evening');
    expect(kind({ name: 'Morning easy' }, 1)).toBe('morning');
    expect(kind({ name: 'Evening intervals' }, 1)).toBe('evening');
    expect(kind({ name: 'Long run', description: 'אימון ערב' }, 1)).toBe('evening');
  });

  it('checks morning/evening before the test guess, so a morning test is still the morning', () => {
    // Both are true of "בוקר - מבחן 3000"; the one that tells the athlete WHICH
    // of the day's two runs this is wins.
    expect(kind({ name: 'בוקר - מבחן 3000' }, 1)).toBe('morning');
  });

  it('does not read ערבוב as the evening session', () => {
    // \b is ASCII-only, so a bare /ערב/ also fires on ערבוב ("mixing") — a
    // plausible name for a fartlek, and it would label it the evening run.
    expect(kind({ name: 'ערבוב קצבים' }, 1)).toBe('main');
  });

  it('still calls a lone morning session "single"', () => {
    // Nothing to disambiguate on a one-workout day.
    expect(kind({ name: 'בוקר - 8 ק״מ' })).toBe('single');
  });
});

describe('normalizeWorkoutParts — optional sessions', () => {
  const optional = (w: Partial<ParsedWorkout>) =>
    normalizeWorkoutParts({ workouts: [workout(w)] }).workouts[0].optional;

  it('marks a session the coach only offered', () => {
    expect(optional({ name: 'ערב - אופציה' })).toBe(true);
    expect(optional({ name: 'Evening', description: 'מי שרוצה' })).toBe(true);
    expect(optional({ name: 'Strides', description: 'optional' })).toBe(true);
  });

  it('leaves a prescribed session unmarked', () => {
    expect(optional({ name: 'ערב - 6 ק״מ' })).toBe(false);
  });

  it('trusts the flag when the parser set one', () => {
    // `?? `, not `||`: an explicit false has to survive a name that merely reads
    // like an offer.
    expect(optional({ name: 'ערב - אופציה', optional: false })).toBe(false);
  });

  it('is outside the key, so labelling one cannot orphan a match', () => {
    const [w] = normalizeWorkoutParts({ workouts: [workout({ dayOfWeek: 2, name: 'אופציה' })] }).workouts;
    expect(w.workoutKey).toBe('day-2-part-1-single');
  });
});

describe('sessionKind — what the UI labels a session', () => {
  it('says nothing on an ordinary single-session day', () => {
    // The day name already says everything; a "part 1" pill on every card in the
    // club would be pure noise.
    expect(sessionKind(workout({ partCount: 1, partKind: 'single' }))).toBeNull();
    expect(sessionKind(workout({}))).toBeNull();
  });

  it('distinguishes morning from evening on a two-a-day', () => {
    expect(sessionKind(workout({ partCount: 2, partKind: 'morning' }))).toBe('morning');
    expect(sessionKind(workout({ partCount: 2, partKind: 'evening' }))).toBe('evening');
  });

  it('falls back to a generic part label for a day split some other way', () => {
    expect(sessionKind(workout({ partCount: 3, partKind: 'warmup' }))).toBe('part');
  });
});

describe('normalizeWorkoutParts — expectations the matcher scores against', () => {
  it('measures the distance from the steps when the coach stated none', () => {
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ steps: [step({ durationValue: 3000 }), step({ durationValue: 2000 })] })],
    }).workouts;
    expect(w.expectedDistanceM).toBe(5000);
  });

  it('prefers the coach\'s stated range midpoint over the steps', () => {
    // 9–11 km in the PDF header beats whatever the transcribed steps add up to.
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ distanceMinKm: 9, distanceMaxKm: 11, steps: [step({ durationValue: 1000 })] })],
    }).workouts;
    expect(w.expectedDistanceM).toBe(10_000);
  });

  it('leaves the distance undefined when there is nothing to measure', () => {
    // Without an expectation the matcher can only judge by day.
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ steps: [step({ durationType: 'open' })] })],
    }).workouts;
    expect(w.expectedDistanceM).toBeUndefined();
  });

  it('sums timed steps into an expected duration, repeats included', () => {
    const [w] = normalizeWorkoutParts({
      workouts: [workout({
        steps: [
          step({ durationType: 'time', durationValue: 600 }),
          step({ durationType: 'open', repeatCount: 4, repeatSteps: [step({ durationType: 'time', durationValue: 90 })] }),
        ],
      })],
    }).workouts;
    expect(w.expectedDurationSec).toBe(960); // 600 + 4×90
  });

  it('leaves the duration undefined when no step states a time', () => {
    const [w] = normalizeWorkoutParts({ workouts: [workout()] }).workouts;
    expect(w.expectedDurationSec).toBeUndefined();
  });
});

describe('normalizeWorkoutParts — distance tolerance', () => {
  const tol = (w: Partial<ParsedWorkout>) =>
    normalizeWorkoutParts({ workouts: [workout(w)] }).workouts[0].distanceToleranceM;

  it('allows 8% of the expected distance', () => {
    expect(tol({ steps: [step({ durationValue: 10_000 })] })).toBe(800);
  });

  it('never goes below 150 m, so a 1 km jog is not held to ±80 m', () => {
    expect(tol({ steps: [step({ durationValue: 1000 })] })).toBe(150);
  });

  it('widens to the coach\'s own range when that is wider than 8%', () => {
    // 9–11 km is ±1000 m by the coach's own words; 8% of 10 km is only 800.
    expect(tol({ distanceMinKm: 9, distanceMaxKm: 11 })).toBe(1000);
  });

  it('ignores a single stated figure as a spread', () => {
    // "10 km", not "9–11 km": there is no range, so the 8% rule applies.
    expect(tol({ distanceMinKm: 10 })).toBe(800);
  });

  it('has no tolerance to state when there is no expected distance', () => {
    expect(tol({ steps: [step({ durationType: 'open' })] })).toBeUndefined();
  });
});

describe('normalizeWorkoutParts — name tokens', () => {
  it('defaults to the part kind and the rounded distance', () => {
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ steps: [step({ durationValue: 8000 })] })],
    }).workouts;
    expect(w.activityNameTokens).toEqual(['single', '8000']);
  });

  it('adds the Hebrew word for a test part, which is how athletes name the run', () => {
    const out = normalizeWorkoutParts({
      workouts: [workout({ dayOfWeek: 2, name: 'מבחן 3000' }), workout({ dayOfWeek: 2, name: 'Cooldown' })],
    }).workouts;
    expect(out[0].activityNameTokens).toContain('מבחן');
    expect(out[0].activityNameTokens).toContain('test');
  });

  it('keeps tokens the parser already produced', () => {
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ activityNameTokens: ['ריצה קלה', 'easy'] })],
    }).workouts;
    expect(w.activityNameTokens).toEqual(['ריצה קלה', 'easy']);
  });

  it('falls back to the defaults when the supplied tokens are all empty', () => {
    const [w] = normalizeWorkoutParts({
      workouts: [workout({ activityNameTokens: ['', ''] })],
    }).workouts;
    expect(w.activityNameTokens).toEqual(['single', '1000']);
  });
});

describe('normalizeParsedWorkouts — whichever shape the blob is', () => {
  it('normalizes a flat plan and preserves the rest of the blob', () => {
    const out = normalizeParsedWorkouts({
      workouts: [workout({ dayOfWeek: 3 })],
      weekLabel: 'week 12',
    });
    expect(out.workouts[0].workoutKey).toBe('day-3-part-1-single');
    expect(out.weekLabel).toBe('week 12');
  });

  it('normalizes all three group variants', () => {
    const out = normalizeParsedWorkouts({
      group1: { workouts: [workout({ dayOfWeek: 1 })] },
      group2: { workouts: [workout({ dayOfWeek: 1 })] },
      group3: { workouts: [workout({ dayOfWeek: 1 })] },
    });
    // Keys are stable ACROSS variants by design — the same day of the same week
    // is the same workout whichever group's paces you run it at.
    expect(out.group1.workouts[0].workoutKey).toBe('day-1-part-1-single');
    expect(out.group2.workouts[0].workoutKey).toBe('day-1-part-1-single');
    expect(out.group3.workouts[0].workoutKey).toBe('day-1-part-1-single');
  });

  it('leaves a group that has no workouts array alone', () => {
    const out = normalizeParsedWorkouts({
      group1: { workouts: [workout({ dayOfWeek: 1 })] },
      group2: { note: 'not published yet' },
    });
    expect(out.group1.workouts[0].workoutKey).toBeDefined();
    expect(out.group2).toEqual({ note: 'not published yet' });
  });

  it('cannot make a malformed blob worse', () => {
    expect(normalizeParsedWorkouts(null)).toBeNull();
    expect(normalizeParsedWorkouts(undefined)).toBeUndefined();
    expect(normalizeParsedWorkouts('nonsense')).toBe('nonsense');
    expect(normalizeParsedWorkouts({ foo: 1 })).toEqual({ foo: 1 });
    expect(normalizeParsedWorkouts({ workouts: 'not an array' })).toEqual({ workouts: 'not an array' });
  });

  it('handles an empty week without inventing anything', () => {
    expect(normalizeParsedWorkouts({ workouts: [] })).toEqual({ workouts: [] });
  });

  it('is idempotent on the grouped shape too', () => {
    const blob = { group1: { workouts: [workout({ dayOfWeek: 1 }), workout({ dayOfWeek: 1 })] } };
    expect(normalizeParsedWorkouts(normalizeParsedWorkouts(blob)))
      .toEqual(normalizeParsedWorkouts(blob));
  });
});
