/**
 * What kind of activity a row is — the one place every reader asks.
 *
 * Until strength training (review-2026-11-20/strength/plan.md) `athlete_activities` held
 * runs only, because both syncs filtered on the way in: every km sum, run count, streak and
 * leaderboard was correct *by accident of ingestion*. Strength rows (distance 0, a duration,
 * maybe a heart rate) now land in the same table, so any reader that counts rows or
 * matches a planned run to "an activity that day" must ask this module instead.
 *
 * `activity_type` values: Garmin's `typeKey` ('running', 'trail_running', 'treadmill_running',
 * …), Strava's mapped to 'running' / 'trail_running', and now 'strength_training' from both.
 * A NULL type is a legacy run (rows from before the column was filled) and stays a run.
 */

export const STRENGTH_TYPE = 'strength_training';

/** Garmin typeKeys that are strength. Yoga/pilates/HIIT are out of b22 (plan.md). */
const GARMIN_STRENGTH = new Set(['strength_training']);
/** Strava `type` / `sport_type` values that are strength. */
const STRAVA_STRENGTH = new Set(['WeightTraining']);

export function isStrengthType(type: string | null | undefined): boolean {
  return type === STRENGTH_TYPE;
}

/** Everything that is not strength counts as a run, as before (NULL included). */
export function isRunActivity(a: { activity_type?: string | null }): boolean {
  return !isStrengthType(a.activity_type ?? null);
}

export function isGarminStrength(typeKey: string | null | undefined): boolean {
  return !!typeKey && GARMIN_STRENGTH.has(typeKey);
}

export function isStravaStrength(a: { type?: string | null; sport_type?: string | null }): boolean {
  return STRAVA_STRENGTH.has(a.sport_type || a.type || '');
}

/**
 * A PostgREST filter that keeps runs (and legacy NULL-typed rows) and drops strength:
 * `.or(RUNS_ONLY_OR)`. Not `.neq(...)` — in SQL `NULL <> 'x'` is NULL, so neq would
 * silently drop every legacy row.
 */
export const RUNS_ONLY_OR = `activity_type.is.null,activity_type.neq.${STRENGTH_TYPE}`;

/** Apply the runs-only filter to any PostgREST builder that supports `.or`. */
export function runsOnly<Q extends { or: (filters: string) => Q }>(q: Q): Q {
  return q.or(RUNS_ONLY_OR);
}
