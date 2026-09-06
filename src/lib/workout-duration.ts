import { ParsedWorkout, WorkoutStep } from './ai/types';

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
 *
 * Returns seconds. Use `workoutDurationSec` for a single midpoint value, or
 * `workoutDurationRangeSec` when you need the min/max.
 */

const DEFAULT_PACE_MIN = 300; // sec/km — fallback fast bound for distance->time
const DEFAULT_PACE_MAX = 360; // sec/km — fallback slow bound

/**
 * "70-80 דק׳", "אופציה ל30-40 דק׳ קל בערב", "45 min easy" → seconds.
 *
 * Deliberately narrow: it only fires on an explicit minutes unit (דק / min), so
 * a pace note ("4:50-5:30") or a rep count ("5x") can never be mistaken for a
 * duration. Only consulted for `open` steps — a step that already states its own
 * time or distance is never second-guessed by its prose.
 */
export function durationRangeFromNotes(notes?: string): { min: number; max: number } | null {
  if (!notes) return null;
  const match = notes.match(/(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*(?:דק|דקות|min\b|minutes\b)/i);
  if (!match) return null;
  const low = parseInt(match[1], 10);
  const high = match[2] ? parseInt(match[2], 10) : low;
  if (!low || low > high) return null;
  return { min: low * 60, max: high * 60 };
}

function stepDurationRangeSec(step: WorkoutStep): { min: number; max: number } {
  if (step.repeatCount && step.repeatSteps) {
    let min = 0;
    let max = 0;
    for (const sub of step.repeatSteps) {
      const r = stepDurationRangeSec(sub);
      min += r.min;
      max += r.max;
    }
    return { min: min * step.repeatCount, max: max * step.repeatCount };
  }

  if (step.durationType === 'time' && step.durationValue) {
    return { min: step.durationValue, max: step.durationValue };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    const paceMin = step.targetPaceMinPerKm || DEFAULT_PACE_MIN;
    const paceMax = step.targetPaceMaxPerKm || step.targetPaceMinPerKm || DEFAULT_PACE_MAX;
    const km = step.durationValue / 1000;
    // faster pace (smaller sec/km) => less time
    return { min: Math.round(km * paceMin), max: Math.round(km * paceMax) };
  }

  const fromNotes = durationRangeFromNotes(step.notes);
  if (fromNotes) return fromNotes;

  return { min: 0, max: 0 };
}

/**
 * Midpoint duration in SECONDS for a SINGLE step, so a repeat block can state its
 * own total ("×8 … סה״כ 8 דק׳") — the number the athlete needs to know how long
 * the set will take, which no screen showed before.
 */
export function stepDurationSec(step: WorkoutStep): number {
  const { min, max } = stepDurationRangeSec(step);
  return Math.round((min + max) / 2);
}

/** Min/max duration in SECONDS for one workout. */
export function workoutDurationRangeSec(workout: ParsedWorkout): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const step of workout.steps) {
    const r = stepDurationRangeSec(step);
    min += r.min;
    max += r.max;
  }
  return { min, max };
}

/** Midpoint duration in SECONDS for one workout (what most UIs show). */
export function workoutDurationSec(workout: ParsedWorkout): number {
  const { min, max } = workoutDurationRangeSec(workout);
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
