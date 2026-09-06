/**
 * Attribution by Garmin's own answer, instead of by guessing.
 *
 * `activity-matcher.ts` scores every plausible (activity, workout) pair on day and
 * distance and takes the best ones over a threshold. That is the right thing to do
 * for a run someone started by pressing go — but when an athlete starts a
 * *scheduled structured workout* on the watch, Garmin stamps the resulting
 * activity with the `workoutId` of the workout it came from. That id is the one
 * `POST /api/garmin/push-workouts` recorded on the delivery, so the pairing is not
 * a guess at all: the watch is telling us which plan slot this run was.
 *
 * It also settles a question the app could not previously answer — whether a
 * pushed workout ever reached the device. Verifying the push proves Garmin's
 * *account* holds it (see lib/garmin/delivery.ts); an activity carrying its id
 * proves the watch pulled it down and the athlete ran it.
 *
 * Pure, so the assignment rules below are testable without a database.
 */

/** A `workout_deliveries` row, as far as this cares. */
export interface DeliveredWorkout {
  id: string;
  garmin_workout_id: string | null;
  workout_key: string | null;
}

/** An `athlete_activities` row, as far as this cares. */
export interface ActivityWithGarminWorkout {
  id: string;
  garmin_workout_id?: string | null;
}

export interface GarminWorkoutMatch {
  activityId: string;
  workoutKey: string;
  deliveryId: string;
  garminWorkoutId: string;
}

/**
 * Pair activities to the plan parts they were run from, by workout id.
 *
 * One activity to one part and one part to one activity, because
 * `activity_plan_matches` is unique on both — and because a plan slot is one
 * session. Where that forces a choice, input order decides, so the caller's
 * chronological ordering means the first run of a workout claims its slot:
 *
 *  - Two activities carrying the same workout id. Real: a scheduled workout stays
 *    on the calendar, so an athlete who repeats it that day stamps both runs. The
 *    first takes the slot; the second is left to the heuristic, which is free to
 *    place it elsewhere or nowhere.
 *  - Two deliveries carrying the same workout id. Shouldn't happen — Garmin
 *    issues a fresh id per create — but a re-push whose cleanup failed can leave
 *    an old row behind, so it is handled rather than trusted.
 *
 * Deliveries with no workout id (a push that failed) or no workout key (recorded
 * before migration 092) are not usable evidence and are skipped, not guessed at.
 */
export function pairByGarminWorkoutId(
  activities: ActivityWithGarminWorkout[],
  deliveries: DeliveredWorkout[],
): GarminWorkoutMatch[] {
  const keyByWorkoutId = new Map<string, { workoutKey: string; deliveryId: string }>();
  for (const delivery of deliveries) {
    const workoutId = delivery.garmin_workout_id?.trim();
    if (!workoutId || !delivery.workout_key) continue;
    if (keyByWorkoutId.has(workoutId)) continue;
    keyByWorkoutId.set(workoutId, { workoutKey: delivery.workout_key, deliveryId: delivery.id });
  }
  if (keyByWorkoutId.size === 0) return [];

  const matches: GarminWorkoutMatch[] = [];
  const usedKeys = new Set<string>();
  for (const activity of activities) {
    const workoutId = activity.garmin_workout_id?.trim();
    if (!workoutId) continue;
    const delivered = keyByWorkoutId.get(workoutId);
    if (!delivered || usedKeys.has(delivered.workoutKey)) continue;
    usedKeys.add(delivered.workoutKey);
    matches.push({
      activityId: activity.id,
      workoutKey: delivered.workoutKey,
      deliveryId: delivered.deliveryId,
      garminWorkoutId: workoutId,
    });
  }
  return matches;
}
