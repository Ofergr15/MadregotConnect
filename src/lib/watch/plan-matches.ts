/**
 * Attribution by the plan id Apple hands back — the Apple twin of
 * lib/plans/garmin-workout-matches.ts.
 *
 * The iPhone app schedules each delivery as `WorkoutPlan(workout, id: <the
 * delivery's provider_plan_id>)`. When the athlete starts it from the watch,
 * HealthKit records the plan on the finished workout (`HKWorkout.workoutPlan`,
 * iOS 17), and the upload carries that id as `athlete_activities.provider_plan_id`.
 * So the pairing is the watch's own statement of which slot this run was — not a
 * score.
 *
 * Same one-to-one rules as the Garmin pairing, for the same reason
 * (`activity_plan_matches` is unique on the activity and on the slot): the first
 * activity, in the caller's chronological order, claims a slot; a delivery
 * without a workout key is not evidence.
 *
 * Pure.
 */

export interface AppleDeliveredWorkout {
  id: string;
  provider_plan_id: string | null;
  workout_key: string | null;
}

export interface ActivityWithProviderPlan {
  id: string;
  provider_plan_id?: string | null;
}

export interface ProviderPlanMatch {
  activityId: string;
  workoutKey: string;
  deliveryId: string;
  providerPlanId: string;
}

const norm = (id: string | null | undefined) => (id || '').trim().toLowerCase();

export function pairByProviderPlanId(
  activities: ActivityWithProviderPlan[],
  deliveries: AppleDeliveredWorkout[],
): ProviderPlanMatch[] {
  const byPlan = new Map<string, { workoutKey: string; deliveryId: string }>();
  for (const d of deliveries) {
    const planId = norm(d.provider_plan_id);
    if (!planId || !d.workout_key || byPlan.has(planId)) continue;
    byPlan.set(planId, { workoutKey: d.workout_key, deliveryId: d.id });
  }
  if (byPlan.size === 0) return [];

  const usedKeys = new Set<string>();
  const out: ProviderPlanMatch[] = [];
  for (const activity of activities) {
    const planId = norm(activity.provider_plan_id);
    if (!planId) continue;
    const hit = byPlan.get(planId);
    if (!hit || usedKeys.has(hit.workoutKey)) continue;
    usedKeys.add(hit.workoutKey);
    out.push({ activityId: activity.id, workoutKey: hit.workoutKey, deliveryId: hit.deliveryId, providerPlanId: planId });
  }
  return out;
}

/** True when any of these activities carries an Apple plan id — the gate for the extra query. */
export function anyProviderPlan(activities: ActivityWithProviderPlan[]): boolean {
  return activities.some((a) => !!norm(a.provider_plan_id));
}
