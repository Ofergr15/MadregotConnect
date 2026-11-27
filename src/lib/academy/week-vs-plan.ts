// ═════════════════════════════════════════════════════════════════════════════
// "THIS WEEK VS PLAN" — one trainee's week, one row per planned session, with the
// answer from EACH of the four engines kept apart (CLAUDE.md "four engines, not
// one"). Night task 55: one shape for both the web and the native app, so neither
// re-derives a verdict client-side.
//
//   distance  assessWorkout     (academy/adherence.ts)   the run's totals
//   pace      gradePlanBlocks   (academy/execution.ts)   a distance/time trace
//   reps      findPlannedEfforts(academy/segments.ts)    the watch's laps
//   watch     gradeWatchSteps   (academy/watch-steps.ts) the device's own step list
//
// The engines are not re-run here: computeAcademyWeekAdherence already ran them
// for the compliance table, and re-running would let this endpoint and that table
// disagree about the same run. This only REDUCES its rows, and drops `detail`
// (raw laps — never serialised).
//
// Which engine answered pace is read off `paceScope.source`: 'watch' is the
// device's step list (evidence), 'stream'/'laps' a searched block (inference).
// ═════════════════════════════════════════════════════════════════════════════

import type { WorkoutAdherenceRow } from './report';

export type EngineAnswer<T> = { answered: true; value: T } | { answered: false; reason: string };

export interface WeekVsPlanRow {
  date: string;
  name: string;
  completed: boolean;
  activityId: string | null;
  /** assessWorkout: did they cover the distance / time? */
  distance: EngineAnswer<{ status: string; pct: number | null; durationStatus: string }>;
  /** gradePlanBlocks: the pace of the block a searched trace located. */
  pace: EngineAnswer<{ direction: string; deviationSec: number | null; label: string; truncated: boolean }>;
  /** findPlannedEfforts: the reps the plan asked for vs found in the laps. */
  reps: EngineAnswer<{ needed: number; attempted: number; found: number }>;
  /** gradeWatchSteps: the device's own verdict on the step it ran. */
  watch: EngineAnswer<{ direction: string; deviationSec: number | null; label: string; truncated: boolean }>;
  /** The one combined verdict the run shows (score + direction), unchanged. */
  overall: { score: number | null; direction: string; status: string } | null;
}

export interface WeekVsPlan {
  athleteId: string;
  weekStart: string;
  plannedCount: number;
  completedCount: number;
  rows: WeekVsPlanRow[];
}

const no = (reason: string) => ({ answered: false as const, reason });

export function toWeekVsPlanRow(w: WorkoutAdherenceRow): WeekVsPlanRow {
  const verdict = w.detail?.verdict ?? null;
  const notRun = !w.completed || !w.actual;
  const scope = verdict?.paceScope ?? null;
  const paceValue = scope && verdict
    ? { direction: verdict.direction, deviationSec: verdict.paceDeviationSec, label: scope.label, truncated: scope.truncated }
    : null;
  const efforts = verdict?.effortCounts ?? null;

  return {
    date: w.date,
    name: w.name,
    completed: w.completed,
    activityId: w.actual?.id ?? null,
    distance: notRun
      ? no('not_run')
      : { answered: true, value: { status: w.distance.status, pct: w.distance.pct, durationStatus: w.duration.status } },
    pace: notRun ? no('not_run')
      : !verdict ? no('ungraded')
      : paceValue && scope!.source !== 'watch' ? { answered: true, value: paceValue }
      : no(scope?.source === 'watch' ? 'watch_answered' : 'no_block'),
    reps: notRun ? no('not_run')
      : efforts && efforts.needed > 0 ? { answered: true, value: { ...efforts } }
      : no('no_reps_planned'),
    watch: notRun ? no('not_run')
      : paceValue && scope!.source === 'watch' ? { answered: true, value: paceValue }
      : no('not_a_watch_workout'),
    overall: w.execution ? { score: w.execution.score, direction: w.execution.direction, status: w.execution.status } : null,
  };
}

export function toWeekVsPlan(athleteId: string, weekStart: string, week: { plannedCount: number; completedCount: number; workouts: WorkoutAdherenceRow[] }): WeekVsPlan {
  return {
    athleteId,
    weekStart,
    plannedCount: week.plannedCount,
    completedCount: week.completedCount,
    rows: week.workouts.map(toWeekVsPlanRow),
  };
}
