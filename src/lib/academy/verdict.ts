import type { MetricStatus, PaceStatus, WorkoutAdherence } from './adherence';
import type { EffortReport } from './segments';

// ── One run, graded against the day's plan ──────────────────────────────────
// The academy compliance table already answers "did this athlete follow the
// plan" — for the one athlete flagged `is_academy`. This is the same answer for
// a single run, so it can sit on the activity detail and the feed card for
// everyone else. The grading itself is not re-implemented here: the whole-run
// metrics come from `assessWorkout` and the per-rep check from
// `findPlannedEfforts`, so a coach cannot get two different verdicts for the
// same run out of two screens.
//
// This module owns only the shape those two surfaces share, and the reduction to
// a single headline — which must also be the same on both.

/** The payload of `GET /api/academy/segments?verdict=1`, and of the feed badge. */
export interface PlanVerdict {
  workoutName: string;
  date: string;
  activityId: string;
  distance: WorkoutAdherence['distance'];
  duration: WorkoutAdherence['duration'];
  pace: WorkoutAdherence['pace'];
  /** 0..1 — fraction of computable whole-run metrics on target. */
  score: number;
  /**
   * The per-rep check. Null on the feed: it needs per-step laps, which are cached
   * for a few hundred rows all-time and cannot be fetched from Garmin in a list
   * request. The activity detail fetches them on demand, so it has this.
   */
  efforts?: EffortReport | null;
  /** True when the watch drove the structured workout (one lap per planned step). */
  alignedToWatch?: boolean;
}

export type PlanVerdictLevel = 'on_plan' | 'partly' | 'off_plan' | 'unknown';

/**
 * The one-word answer. The per-rep check wins when it reached a conclusion: on a
 * quality session it is the stronger evidence — 12 km of easy running can put
 * distance "on target" for a day that asked for 6×400, and the laps are what
 * show whether the reps happened. When the laps can't answer (auto 1 km laps, a
 * steady run with no reps to look for), fall back to the whole-run metrics.
 */
export function verdictLevel(verdict: PlanVerdict): PlanVerdictLevel {
  const efforts = verdict.efforts;
  if (efforts) {
    if (efforts.verdict === 'confirmed') return 'on_plan';
    if (efforts.verdict === 'partial') return 'partly';
    if (efforts.verdict === 'missed') return 'off_plan';
  }
  const graded = [verdict.distance.status, verdict.duration.status, verdict.pace.status]
    .filter(s => s !== 'unknown');
  if (graded.length === 0) return 'unknown';
  const onTarget = graded.filter(s => s === 'on_target').length;
  if (onTarget === graded.length) return 'on_plan';
  return onTarget > 0 ? 'partly' : 'off_plan';
}

/**
 * True when the run missed the plan only by doing MORE — further, faster, or both,
 * and nothing short or slow.
 *
 * A coach still wants to see it: ignoring an easy day's pace ceiling is the
 * classic way to train yourself into a hole, which is why it isn't graded as
 * on-target. But "further and faster than asked" and "skipped half the session"
 * are not the same news, and a red badge on the club feed for the first one reads
 * as an accusation. Callers use this to label and colour that case separately.
 *
 * Takes the two statuses rather than a whole verdict so the feed's compact badge
 * payload can call it too. Duration is deliberately not consulted: a faster run
 * covering the planned distance comes in under the planned time by arithmetic,
 * and counting that as a second offence would flip every fast run out of here.
 */
export function exceededPlan(distanceStatus: MetricStatus, paceStatus: PaceStatus): boolean {
  const over = distanceStatus === 'over' || paceStatus === 'faster';
  const short = distanceStatus === 'under' || paceStatus === 'slower';
  return over && !short;
}
