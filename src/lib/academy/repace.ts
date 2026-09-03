// Shifting a workout's paces by a trainee's band offset.
//
// This is the transform the academy was missing. `groups.pace_profile.offsetSeconds`
// has existed for the club for a long time and is stored, displayed and edited —
// but nothing ever applied it to a pace, because the club separates its three
// groups a different way: the coach writes "3:20 (3:30) ((3:40))" by hand and
// @/lib/ai/splitGroups resolves each bracket into its own lane. An offset in
// sec/km had no code path at all.
//
// The academy can't work that way. Six goal bands run from a sub-3 marathon to
// starting from zero, a coach writes one workout for one trainee, and the number
// that separates them is exactly the sec/km offset on their band (or their own
// override). So the offset has to become real arithmetic on the paces — which is
// what this file is, and nothing more.
//
// Pure and Supabase-free so the same shift runs in the composer, in the tests,
// and in anything later that needs it (a preview, a cron, a report).

import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace } from '@/lib/garmin/pace';

/**
 * Pace bounds, sec/km, applied after every shift.
 *
 * 120 (2:00/km) is faster than any human holds for a kilometre and 1800
 * (30:00/km) is slower than a walk, so anything outside them is arithmetic that
 * escaped rather than a pace anyone meant. They exist because these numbers end
 * up as a pace-zone alert on a watch: a −120 override against a 3:00 interval
 * would otherwise produce 1:00/km, and Garmin would happily accept it and beep
 * at the runner for the whole rep.
 */
export const MIN_PACE_SEC_PER_KM = 120;
export const MAX_PACE_SEC_PER_KM = 1800;

function clampPace(sec: number): number {
  return Math.min(MAX_PACE_SEC_PER_KM, Math.max(MIN_PACE_SEC_PER_KM, sec));
}

function shiftSec(sec: number, offsetSec: number): number {
  return clampPace(Math.round(sec + offsetSec));
}

// Any m:ss token — the only form a pace is ever written in, in notes or on screen.
const PACE_TOKEN_RE = /(\d{1,3}):(\d{2})/g;

/**
 * Shift every pace token inside a free-text note.
 *
 * The notes are not decoration: `buildStepDescription` in the Garmin converter
 * keeps them **verbatim** whenever they already contain a pace, and that string
 * is what the watch prints mid-run. Shifting only the numeric fields would leave
 * the trainee reading the pace their band does not run.
 *
 * Callers apply this to pace steps only (see `shiftStep`). That gate is what
 * makes a blanket m:ss replace safe: a rest step's "2:00 הליכה" is a duration,
 * not a pace, and a rest step is never `targetType: 'pace'`.
 */
export function shiftPacesInNotes(notes: string, offsetSec: number): string {
  return notes.replace(PACE_TOKEN_RE, (_m, mm: string, ss: string) =>
    formatPace(shiftSec(parseInt(mm, 10) * 60 + parseInt(ss, 10), offsetSec)));
}

function shiftStep(step: WorkoutStep, offsetSec: number): WorkoutStep {
  const out: WorkoutStep = { ...step };

  if (typeof out.targetPaceMinPerKm === 'number') {
    out.targetPaceMinPerKm = shiftSec(out.targetPaceMinPerKm, offsetSec);
  }
  if (typeof out.targetPaceMaxPerKm === 'number') {
    out.targetPaceMaxPerKm = shiftSec(out.targetPaceMaxPerKm, offsetSec);
  }
  // The club's second and third lanes are shifted too rather than dropped. A
  // trainee's plan only ever reads lane one, but a row holding a shifted lane 1
  // next to an untouched lane 2 is a row that contradicts itself, and something
  // downstream will eventually read the wrong one.
  if (out.group2Pace) {
    out.group2Pace = { min: shiftSec(out.group2Pace.min, offsetSec), max: shiftSec(out.group2Pace.max, offsetSec) };
  }
  if (out.group3Pace) {
    out.group3Pace = { min: shiftSec(out.group3Pace.min, offsetSec), max: shiftSec(out.group3Pace.max, offsetSec) };
  }

  // Heart-rate targets are percentages of max HR — already individual to the
  // athlete, and nothing about a goal band makes them move.

  if (out.targetType === 'pace' && out.notes) {
    out.notes = shiftPacesInNotes(out.notes, offsetSec);
  }

  if (out.repeatSteps) {
    out.repeatSteps = out.repeatSteps.map((s) => shiftStep(s, offsetSec));
  }

  return out;
}

/** One workout with every pace moved by `offsetSec` sec/km. */
export function shiftWorkoutPaces(workout: ParsedWorkout, offsetSec: number): ParsedWorkout {
  if (offsetSec === 0) return workout;
  return { ...workout, steps: workout.steps.map((s) => shiftStep(s, offsetSec)) };
}

/**
 * A week of workouts re-paced for one trainee, or **returned untouched**.
 *
 * `null` means the trainee's paces cannot be resolved — their band has no offset
 * and they have no override — and the answer then is the workout exactly as the
 * coach wrote it, not a guessed one. `effectiveOffsetSec` in
 * @/lib/academy/bands draws that null/0 distinction; this is the caller that
 * makes it matter. The UI warns, and the push suppresses the watch's pace
 * alerts, so an unresolved trainee gets the coach's paces as information rather
 * than a device beeping at a target nobody set for them.
 *
 * Returns the same array identity when there is nothing to do, so an untouched
 * plan saves as an untouched plan.
 */
export function repaceWeek(workouts: ParsedWorkout[], offsetSec: number | null): ParsedWorkout[] {
  if (offsetSec === null || offsetSec === 0) return workouts;
  return workouts.map((w) => shiftWorkoutPaces(w, offsetSec));
}
