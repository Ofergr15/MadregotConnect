import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { weekTargetRange } from '@/lib/plans/week-target';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';

/**
 * The feed card's week target, read the SAME way as the profile's "השבוע שלי" ring
 * (`ringNumbers` → `weekTargetRange`, over the member's own lane via /api/plans/week
 * `lane=mine`), so the two cards on one screen can never disagree.
 *
 * It used to be `buildWeekBreakdown(parsed).weekTotalMin` over group 1's column:
 * every offered "ערב אופציה" counted into the floor, and every member was measured
 * against lane 1 — the same 125.7 km for the whole club while the ring said 113–157.
 *
 * `lane` is null for an athlete's own (academy) plan, which is already theirs.
 */
export function planWeekTarget(parsed: unknown, lane: Lane | null): { targetMin: number; targetMax: number } {
  let source: unknown = parsed;
  if (lane) {
    const workouts = laneWorkouts(parsed, lane);
    // An empty lane would read as "no plan"; lane 1's week is better than none (same as /api/plans/week).
    if (workouts.length) source = { workouts };
  }
  const range = weekTargetRange({ hasPlan: true, ...buildWeekBreakdown(source) });
  return range ? { targetMin: range.min, targetMax: range.max } : { targetMin: 0, targetMax: 0 };
}
