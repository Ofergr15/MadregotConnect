import type { ParsedWorkout } from '@/lib/ai/types';
import { activityLocalDay } from '@/lib/utils';

export interface MatchableActivity {
  id: string;
  start_time: string;
  distance: number | null;
  activity_name?: string | null;
}

export interface ActivityPartMatch {
  activityId: string;
  workoutKey: string;
  score: number;
  evidence: {
    activityDistanceM: number | null;
    expectedDistanceM: number | null;
    distanceDifferenceM: number | null;
    distanceToleranceM: number | null;
    activityOrder: number;
    partIndex: number;
    matchedNameTokens: string[];
    /** 0 = ran on the planned day, 1 = shifted by a day. See DAY_SHIFT_SCORE. */
    dayDelta: number;
    plannedDayOfWeek: number;
  };
}

/**
 * Starting score for a pair on the planned day, and for one shifted by a day.
 *
 * Attribution used to require an exact date, which meant an athlete who moved
 * Tuesday's intervals to Wednesday was recorded as having skipped Tuesday AND run
 * something unplanned on Wednesday. Measured against production, 41 unclaimed plan
 * slots had an unused activity sitting exactly one day away.
 *
 * A shifted day is allowed but heavily penalised rather than accepted outright, so
 * whenever an activity does exist on the planned day it always wins the slot —
 * greedy assignment takes the highest-scoring pair first. The 18-point handicap
 * also means a shifted pair only clears the 45 threshold when the distance is a
 * genuinely close fit (within ~1.3× tolerance), not merely because both days had
 * a run in them.
 */
const SAME_DAY_SCORE = 30;
const DAY_SHIFT_SCORE = 12;
const MAX_DAY_DELTA = 1;

function pairScore(
  activity: MatchableActivity,
  workout: ParsedWorkout,
  activityOrder: number,
): ActivityPartMatch | null {
  if (!workout.workoutKey) return null;
  // Linear, not circular: the caller has already narrowed the activities to this
  // plan's Sun→Sat week, so a Sunday workout run on Saturday is six days late,
  // not one day early.
  const dayDelta = Math.abs(activityLocalDay(activity.start_time) - workout.dayOfWeek);
  if (dayDelta > MAX_DAY_DELTA) return null;

  const actual = activity.distance || null;
  const expected = workout.expectedDistanceM || null;
  const tolerance = workout.distanceToleranceM || (expected ? Math.max(150, expected * 0.08) : null);
  const difference = actual != null && expected != null ? Math.abs(actual - expected) : null;
  if (
    difference != null &&
    tolerance != null &&
    difference > Math.max(tolerance * 3, 1200)
  ) {
    return null;
  }

  let score = dayDelta === 0 ? SAME_DAY_SCORE : DAY_SHIFT_SCORE;
  if (difference != null && tolerance != null) {
    score += Math.max(0, 50 * (1 - difference / Math.max(tolerance * 2, 1)));
  } else {
    score += 15;
  }

  const partIndex = workout.partIndex || 1;
  score += Math.max(0, 15 - Math.abs(activityOrder - partIndex) * 8);

  const haystack = (activity.activity_name || '').toLowerCase();
  const matchedNameTokens = (workout.activityNameTokens || []).filter(
    (token) => token.length >= 2 && haystack.includes(token.toLowerCase()),
  );
  score += Math.min(10, matchedNameTokens.length * 5);

  return {
    activityId: activity.id,
    workoutKey: workout.workoutKey,
    score: Math.round(Math.min(100, score) * 100) / 100,
    evidence: {
      activityDistanceM: actual,
      expectedDistanceM: expected,
      distanceDifferenceM: difference,
      distanceToleranceM: tolerance ? Math.round(tolerance) : null,
      activityOrder,
      partIndex,
      matchedNameTokens,
      dayDelta,
      plannedDayOfWeek: workout.dayOfWeek,
    },
  };
}

/**
 * Greedy one-to-one assignment after scoring every valid pair — the planned day
 * plus, at a penalty, the day either side of it.
 * Existing manual matches should be removed from both input arrays by the caller.
 */
export function matchActivityParts(
  activities: MatchableActivity[],
  workouts: ParsedWorkout[],
  minimumScore = 45,
): ActivityPartMatch[] {
  const orderedActivities = [...activities].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );
  const orderedWorkouts = [...workouts].sort(
    (a, b) => (a.partIndex || 1) - (b.partIndex || 1),
  );
  const orderWithinDay = new Map<string, number>();
  for (let day = 0; day <= 6; day++) {
    orderedActivities
      .filter((activity) => activityLocalDay(activity.start_time) === day)
      .forEach((activity, index) => orderWithinDay.set(activity.id, index + 1));
  }
  const pairs = orderedActivities.flatMap((activity) =>
    orderedWorkouts
      .map((workout) => pairScore(activity, workout, orderWithinDay.get(activity.id) || 1))
      .filter((pair): pair is ActivityPartMatch => Boolean(pair)),
  );
  pairs.sort((a, b) => b.score - a.score);

  const usedActivities = new Set<string>();
  const usedWorkouts = new Set<string>();
  const matches: ActivityPartMatch[] = [];
  for (const pair of pairs) {
    if (pair.score < minimumScore) continue;
    if (usedActivities.has(pair.activityId) || usedWorkouts.has(pair.workoutKey)) continue;
    usedActivities.add(pair.activityId);
    usedWorkouts.add(pair.workoutKey);
    matches.push(pair);
  }
  return matches.sort((a, b) => a.evidence.activityOrder - b.evidence.activityOrder);
}
