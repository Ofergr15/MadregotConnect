// Reading one pace lane out of a club group plan, so an academy trainee can be
// given the session the club is doing that week.
//
// The mismatch this bridges: a club plan for one week is three pace lanes
// (`GroupedWeeklyPlans` — hard-typed `{group1, group2, group3}` and read in a
// dozen places, so it cannot be widened), while the academy has six goal bands
// and plans one trainee at a time on a single-lane `ParsedWeeklyPlan`. Importing
// therefore has to *choose* a lane, and the choice has to be visible to the
// coach rather than assumed — three lanes and six bands do not map one to one.
//
// Pure, so the picker, the tests and any later preview all resolve a lane the
// same way.

import { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';

export type Lane = 1 | 2 | 3;

export const LANE_MARKS: Record<Lane, string> = { 1: '❶', 2: '❷', 3: '❸' };

/**
 * The lane a band's trainees read by default, or **null when there is no basis**.
 *
 * The bands are numbered as the academy counts them (4-9) and ordered by goal:
 * 4 sub-3, 5 around 3:30, 6 finish a marathon, 7 half prep, 8 5K/10K, 9 from
 * zero. Pairing them off two-to-a-lane keeps the fast bands on the club's fast
 * lane and the beginners on its slowest.
 *
 * It is only a starting point — the picker shows which lane was chosen and lets
 * the coach change it — but a wrong default that nobody notices is still a
 * workout at the wrong pace, which is why an unbanded trainee returns null and
 * makes the coach pick instead of quietly landing on a lane.
 */
export function laneForBand(bandNumber: number | null | undefined): Lane | null {
  if (typeof bandNumber !== 'number') return null;
  if (bandNumber <= 5) return 1;
  if (bandNumber <= 7) return 2;
  return 3;
}

type MaybePlan = {
  workouts?: ParsedWorkout[];
  group1?: { workouts?: ParsedWorkout[] };
  group2?: { workouts?: ParsedWorkout[] };
  group3?: { workouts?: ParsedWorkout[] };
};

/**
 * The workouts of one lane, from either stored shape of `parsed_workouts`.
 *
 * Both exist in the live table: older rows hold three pre-split
 * `group1`/`group2`/`group3` buckets, newer ones hold a single unified
 * `workouts` array carrying `group2Pace`/`group3Pace` and the coach's bracket
 * notation. A flat plan is run through `splitIntoGroups` for **every** lane
 * including the first, because that is also what rewrites
 * "3:20 (3:30) ((3:40))" down to the one pace this trainee is actually being
 * asked to run — an imported note still listing three is a note the watch will
 * print in full.
 */
export function laneWorkouts(parsed: unknown, lane: Lane): ParsedWorkout[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const plan = parsed as MaybePlan;

  const bucket = plan[`group${lane}` as 'group1' | 'group2' | 'group3'];
  if (Array.isArray(bucket?.workouts)) return bucket.workouts;

  if (Array.isArray(plan.workouts)) {
    return splitIntoGroups({ workouts: plan.workouts })[`group${lane}`].workouts;
  }
  return [];
}

/**
 * Whether the three lanes actually differ.
 *
 * Most club weeks are written with one pace for everybody, and asking a coach to
 * choose between three identical options is a decision with no content. When
 * this is false the picker hides the lane selector entirely.
 */
export function lanesDiffer(parsed: unknown): boolean {
  const one = JSON.stringify(laneWorkouts(parsed, 1));
  if (!one) return false;
  return one !== JSON.stringify(laneWorkouts(parsed, 2))
    || one !== JSON.stringify(laneWorkouts(parsed, 3));
}
