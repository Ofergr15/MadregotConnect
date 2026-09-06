import { ParsedWorkout, WorkoutStep } from './ai/types';
import {
  type EstimateOptions,
  minutesRangeFromNotes,
  stepTimeRange,
  workoutTimeEstimate,
} from './plans/step-estimate';

/**
 * Canonical per-workout DURATION estimation — the mirror of workout-distance.ts,
 * and for the same reason: every screen had its own copy of the sum and they all
 * had the same bug.
 *
 * The bug: three separate `estimateTime()` helpers (WeekView, WeekView's detail
 * sheet, WorkoutPreview) added up `durationType === 'time'` steps and silently
 * ignored every distance step. So Sunday — 2 km warmup + 20 km @4:25 + 8×(15s on
 * / 45s walk) — reported "8m", because the only clock in it is the 8-minute
 * strides block; and the week total said "3h59m" for a 120 km week. A card that
 * says a 23.5 km session takes eight minutes is worse than a card with no time
 * on it at all.
 *
 * Priority per step:
 *   1. `time` steps count directly (they ARE seconds).
 *   2. `distance` steps convert with their target pace — the same pace the card
 *      already prints, so the arithmetic is reproducible by eye.
 *   3. `open` steps ("70-80 דק׳ ריצת שחרור קלה") carry their duration only in
 *      prose, so the minutes are read out of the note. This is not a heuristic
 *      for style points: an open step is how the program writes an easy day, and
 *      without it Wednesday contributes nothing to the week's time.
 *   4. A note stating a RANGE the stored `durationValue` sits inside outranks it,
 *      because that is a range the parser collapsed to its midpoint: Saturday's
 *      "40-50 דק׳" is stored as 2700 s, and 45 minutes is a figure the coach
 *      never wrote.
 *
 * The arithmetic is `lib/plans/step-estimate.ts`; this file is the duration-shaped
 * door onto it. Returns seconds. Use `workoutDurationSec` for a single midpoint
 * value, or `workoutDurationRangeSec` when you need the min/max.
 */

/**
 * "70-80 דק׳", "אופציה ל30-40 דק׳ קל בערב", "45 min easy" → seconds.
 *
 * Deliberately narrow: it only fires on an explicit minutes unit (דק / min), so
 * a pace note ("4:50-5:30") or a rep count ("5x") can never be mistaken for a
 * duration. Kept as an alias because callers import this name.
 */
export const durationRangeFromNotes = minutesRangeFromNotes;

/**
 * Midpoint duration in SECONDS for a SINGLE step, so a repeat block can state its
 * own total ("×8 … סה״כ 8 דק׳") — the number the athlete needs to know how long
 * the set will take, which no screen showed before.
 */
export function stepDurationSec(step: WorkoutStep, opts?: EstimateOptions): number {
  const { min, max } = stepTimeRange(step, opts).range;
  return Math.round((min + max) / 2);
}

/** Min/max duration in SECONDS for one workout. */
export function workoutDurationRangeSec(
  workout: ParsedWorkout,
  opts?: EstimateOptions,
): { min: number; max: number } {
  return workoutTimeEstimate(workout, opts).range;
}

/** Midpoint duration in SECONDS for one workout (what most UIs show). */
export function workoutDurationSec(workout: ParsedWorkout, opts?: EstimateOptions): number {
  const { min, max } = workoutDurationRangeSec(workout, opts);
  return Math.round((min + max) / 2);
}

/** Total midpoint duration in SECONDS across many workouts. */
export function totalDurationSec(workouts: ParsedWorkout[]): number {
  return workouts.reduce((sum, w) => sum + workoutDurationSec(w), 0);
}

/**
 * Seconds → "1h47m" / "47m". Shared so the week header, the day card footer and
 * the detail sheet can't drift into three different formats of the same number.
 */
export function formatDurationShort(seconds: number): string {
  if (seconds <= 0) return '';
  // Round to minutes FIRST, then split: rounding the remainder instead turns
  // 3599s into "60m" rather than "1h".
  const totalMinutes = Math.max(Math.round(seconds / 60), 1);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

/**
 * Seconds → "1:47" / "0:50" — the same duration as a clock.
 *
 * For a COLUMN of durations, one per session down the week. "1h47m" and "50m"
 * are different widths and different shapes, so nine of them stacked don't line
 * up and can't be compared at a glance; `0:50` under `1:47` can. Untranslated on
 * purpose — there is no word in it.
 */
export function formatDurationClock(seconds: number): string {
  if (seconds <= 0) return '';
  const totalMinutes = Math.max(Math.round(seconds / 60), 1);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
}
