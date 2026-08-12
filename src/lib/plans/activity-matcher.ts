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
  };
}

function pairScore(
  activity: MatchableActivity,
  workout: ParsedWorkout,
  activityOrder: number,
): ActivityPartMatch | null {
  if (!workout.workoutKey || activityLocalDay(activity.start_time) !== workout.dayOfWeek) {
    return null;
  }

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

  let score = 30; // same plan day
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
    },
  };
}

/**
 * Greedy one-to-one assignment after scoring every valid same-day pair.
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
