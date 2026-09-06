import type { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { workoutDistanceMeters } from '@/lib/workout-distance';

/**
 * Plan normalization — stamping the matcher hints (`workoutKey`,
 * `expectedDistanceM`, `partIndex`, `distanceToleranceM`, `activityNameTokens`)
 * onto every workout of a weekly plan.
 *
 * This used to live in lib/ai/parser.ts, which instantiates the Anthropic client
 * at module load. That made it unimportable from a read path — so only the two
 * write paths that already talked to the model (the parser itself and the
 * clipboard publish) ever normalized a plan, and `POST`/`PUT /api/plans` stored
 * whatever the planner UI sent, verbatim.
 *
 * The consequence, measured against production: 119 of 140 published workouts
 * had no `workoutKey`, and `activity-matcher.ts` rejects a keyless workout
 * outright — so 1139 of 1188 recorded activities (96%) could never be attributed
 * to the workout they were run for. Only one plan week in ten matched anything.
 *
 * Keys are DETERMINISTIC (`day-{dayOfWeek}-part-{partIndex}-{partKind}`), which
 * is what makes normalizing on read safe: an old plan normalized lazily today
 * gets exactly the keys it would have got at publish time, so a persisted match
 * keeps pointing at the same workout. That's why there's no backfill migration —
 * see `normalizeParsedWorkouts`, applied on both the read and the write side.
 */

/** "ערב - אופציה", "אופציונלי", "מי שרוצה" — offered, not prescribed. */
const OPTIONAL_RE = /אופצי|optional|מי שרוצה/i;
// The lookahead is why these aren't bare words: \b is ASCII-only, so /ערב/ alone
// also fires on ערבוב ("mixing"), which is a plausible thing for a fartlek to be
// called and would label it the evening session.
const MORNING_RE = /בוקר(?![א-ת])|morning|\bam\b/i;
const EVENING_RE = /ערב(?![א-ת])|evening|\bpm\b/i;

function inferPartKind(
  workout: ParsedWorkout,
  partCount: number,
): NonNullable<ParsedWorkout['partKind']> {
  if (workout.partKind) return workout.partKind;
  if (partCount === 1) return 'single';
  const text = `${workout.name} ${workout.description || ''}`.toLowerCase();
  // Before the test/warmup/main guesses: when the day names its sessions בוקר
  // and ערב, that IS the axis it was split on, and mislabelling the evening
  // session "main" is what made two-a-days unreadable in the week view. This
  // does move `workoutKey` for such a day (…-part-2-main → …-part-2-evening),
  // which orphans a persisted manual match — but only on multi-part days whose
  // names say morning/evening, and until now the parser merged those into one
  // part instead of producing two, so there are effectively none to orphan.
  if (MORNING_RE.test(text)) return 'morning';
  if (EVENING_RE.test(text)) return 'evening';
  if (/מבחן|test|race|time trial|3000/.test(text)) return 'test';
  if (workout.steps.every((step) => step.type === 'warmup')) return 'warmup';
  if (workout.steps.every((step) => step.type === 'cooldown' || step.type === 'recovery')) {
    return 'cooldown';
  }
  return 'main';
}

function expectedDuration(steps: WorkoutStep[]): number | undefined {
  let total = 0;
  let hasTime = false;
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      const nested = expectedDuration(step.repeatSteps);
      if (nested) {
        total += nested * step.repeatCount;
        hasTime = true;
      }
    } else if (step.durationType === 'time' && step.durationValue) {
      total += step.durationValue;
      hasTime = true;
    }
  }
  return hasTime ? total : undefined;
}

export function normalizeWorkoutParts(plan: ParsedWeeklyPlan): ParsedWeeklyPlan {
  const perDay = new Map<number, ParsedWorkout[]>();
  for (const workout of plan.workouts) {
    const list = perDay.get(workout.dayOfWeek) || [];
    list.push(workout);
    perDay.set(workout.dayOfWeek, list);
  }

  // Part indices are resolved per DAY rather than per workout, because a supplied
  // index that clashes with a sibling's is worse than no index at all: partIndex
  // goes straight into `workoutKey`, so two workouts on the same day would answer
  // to the same key and each other's persisted matches. The supplied numbers come
  // from the model (lib/ai/prompt.ts asks it for "sequential partIndex starting at
  // 1"), so "2, 2" or "2, 3" for a two-part day is a plausible output, not a
  // hypothetical. Honour the day's numbering only when every part of that day
  // carries a positive index AND they are all distinct; otherwise fall back to
  // list order for the whole day. Still deterministic, which is what lets this run
  // on read as well as on write.
  const resolvedIndex = new Map<ParsedWorkout, number>();
  for (const siblings of perDay.values()) {
    const supplied = siblings.map((w) => w.partIndex);
    const usable =
      supplied.every((i) => typeof i === 'number' && i > 0) &&
      new Set(supplied).size === siblings.length;
    siblings.forEach((w, i) => resolvedIndex.set(w, usable ? (w.partIndex as number) : i + 1));
  }

  return {
    workouts: plan.workouts.map((workout) => {
      const siblings = perDay.get(workout.dayOfWeek) || [workout];
      const partIndex = resolvedIndex.get(workout) || siblings.indexOf(workout) + 1;
      const partCount = siblings.length;
      const partKind = inferPartKind(workout, partCount);
      const measuredDistance = workoutDistanceMeters(workout);
      // A coach-stated km range is the best expectation there is; fall back to
      // whatever the steps measure. Without one of the two the matcher can only
      // judge by day, so this is the difference between a scored match and a
      // coin flip.
      const statedDistance = workout.distanceMinKm
        ? Math.round(((workout.distanceMinKm + (workout.distanceMaxKm || workout.distanceMinKm)) / 2) * 1000)
        : undefined;
      const expectedDistanceM =
        workout.expectedDistanceM || measuredDistance || statedDistance || undefined;
      const expectedDurationSec = workout.expectedDurationSec || expectedDuration(workout.steps);
      // A coach-stated range carries its own tolerance; a single figure gets ±8%
      // (floor 150 m, so a 1 km jog isn't held to ±80 m).
      const statedSpread =
        workout.distanceMinKm && workout.distanceMaxKm && workout.distanceMaxKm > workout.distanceMinKm
          ? Math.round(((workout.distanceMaxKm - workout.distanceMinKm) / 2) * 1000)
          : 0;
      const distanceToleranceM =
        workout.distanceToleranceM ||
        (expectedDistanceM
          ? Math.max(150, statedSpread, Math.round(expectedDistanceM * 0.08))
          : undefined);
      const defaultTokens = [
        partKind,
        partKind === 'test' ? 'מבחן' : '',
        expectedDistanceM ? String(Math.round(expectedDistanceM)) : '',
      ].filter(Boolean);

      return {
        ...workout,
        workoutKey: `day-${workout.dayOfWeek}-part-${partIndex}-${partKind}`,
        partIndex,
        partCount,
        partKind,
        // Not part of the key, so inferring it costs nothing and labels the
        // sessions already stored with "אופציה" only in their name.
        optional:
          workout.optional ?? OPTIONAL_RE.test(`${workout.name} ${workout.description || ''}`),
        expectedDistanceM,
        expectedDurationSec,
        distanceToleranceM,
        activityNameTokens:
          workout.activityNameTokens?.filter(Boolean).length
            ? workout.activityNameTokens.filter(Boolean)
            : defaultTokens,
      };
    }),
  };
}

/** True when the blob is the three-group shape rather than a flat plan. */
function isGrouped(value: unknown): boolean {
  const object = value as Record<string, { workouts?: unknown }> | null;
  return Boolean(object && !Array.isArray((object as { workouts?: unknown }).workouts)
    && ['group1', 'group2', 'group3'].some((key) => Array.isArray(object[key]?.workouts)));
}

/**
 * Normalize a whole `weekly_plans.parsed_workouts` blob, whichever shape it is:
 * the flat `{ workouts }` of older plans, or `{ group1, group2, group3 }`. Any
 * other keys on the blob are preserved untouched.
 *
 * Idempotent, so it is safe to call on every read as well as every write.
 * Returns the input unchanged when there is nothing recognisable to normalize,
 * so a malformed blob can never be made worse by passing through here.
 */
export function normalizeParsedWorkouts<T>(parsed: T): T {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const flat = parsed as { workouts?: ParsedWorkout[] };
  if (Array.isArray(flat.workouts)) {
    return { ...parsed, workouts: normalizeWorkoutParts({ workouts: flat.workouts }).workouts };
  }

  if (!isGrouped(parsed)) return parsed;

  const out = { ...(parsed as Record<string, unknown>) };
  for (const key of ['group1', 'group2', 'group3'] as const) {
    const group = out[key] as ParsedWeeklyPlan | undefined;
    if (Array.isArray(group?.workouts)) {
      out[key] = { ...group, workouts: normalizeWorkoutParts(group).workouts };
    }
  }
  return out as T;
}
