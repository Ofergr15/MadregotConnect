import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

/**
 * One estimator for "how far and how long is this?", plus an honest answer to
 * "where did that number come from?".
 *
 * Four copies of this arithmetic existed — `lib/workout-distance.ts`,
 * `lib/plans/workout-parsing.ts`, `lib/academy/adherence.ts` and
 * `lib/workout-duration.ts` — and they had already drifted: one credited a
 * 90-second walking recovery with running distance, one inverted its range when
 * a step carried only a slow pace, and one showed the athlete a different weekly
 * total than the adherence score used. The `adherence.ts` copy even carries the
 * comment "mirrors the estimator in the weekly dashboard route so planned
 * distances stay consistent" — which is a note saying the sync is manual and
 * therefore eventually wrong. They all call in here now.
 *
 * The other half of the job is the plan the coach actually writes. Two of this
 * club's nine weekly sessions state a time and no distance ("70-80 דק׳ ריצת
 * שחרור קלה", "אופציה ל30-40 דק׳ קל בערב"), and one has its range collapsed to
 * a midpoint at parse time ("40-50 דק׳" arrives as `durationValue: 2700`). A
 * time and a pace multiply into a distance, so those sessions do have a km
 * figure — a RANGE, wide at the ends, which is what the coach wrote.
 */

export interface Range {
  min: number;
  max: number;
}

/**
 * How much a number deserves to be trusted, best first.
 *
 * - `coach`    — the km range written on the plan itself (`distanceMinKm`).
 * - `measured` — the step's own `durationValue`, in the unit being asked about.
 * - `stated`   — a figure read out of the coach's note ("70-80 דק׳").
 * - `derived`  — a multiplication of two of the above (time × the coach's pace).
 * - `assumed`  — a multiplication using a pace nobody wrote down.
 * - `none`     — nothing to go on. Contributes zero rather than a guess.
 *
 * This exists so the UI can mark an inferred distance with a `~` and never let
 * it impersonate one the coach signed off on.
 */
export type Provenance = 'coach' | 'measured' | 'stated' | 'derived' | 'assumed' | 'none';

const PROVENANCE_RANK: Record<Provenance, number> = {
  coach: 0, measured: 1, stated: 2, derived: 3, assumed: 4, none: 5,
};

/**
 * A total is only as trustworthy as its shakiest part: a 25 km session whose
 * last km is a guess is a derived 25 km, not a measured one.
 */
export function weakest(...values: Provenance[]): Provenance {
  return values.reduce((worst, v) => (PROVENANCE_RANK[v] > PROVENANCE_RANK[worst] ? v : worst), 'coach');
}

/** True when the number was calculated rather than read — the `~` test. */
export function isEstimate(from: Provenance): boolean {
  return from === 'derived' || from === 'assumed';
}

export interface Estimate {
  range: Range;
  from: Provenance;
}

const NOTHING: Estimate = { range: { min: 0, max: 0 }, from: 'none' };

/**
 * Pace bands of last resort, seconds per km.
 *
 * `recovery` is separate because one band for everything credited a walking
 * rest with running distance: the 45-second "הליכה" between two strides was
 * priced at 5:00–6:00/km, the same as the strides themselves.
 *
 * Prefer `easyPaceBand()` over the running default when a whole week is in
 * hand — this club's easy pace is 4:50–5:30, and using 5:00–6:00 makes every
 * estimate slower and shorter than anything the coach has ever prescribed.
 */
export const ASSUMED_PACE = {
  running: { min: 300, max: 360 },
  recovery: { min: 420, max: 540 },
} as const;

export interface EstimateOptions {
  /** Pace band for a running step with no pace of its own. */
  easyBand?: Range;
  /** Pace band for a rest or recovery step with no pace of its own. */
  recoveryBand?: Range;
  /**
   * Credit an open-ended warmup or cooldown that carries NO information at all
   * with a nominal 2 km.
   *
   * Off by default, and a flag rather than a decision because the three callers
   * consolidated in here disagreed about it and each has a case: the athlete's
   * weekly km and the matcher's `expectedDistanceM` should not contain metres
   * nobody wrote (`workout-distance.ts` returned 0), while an adherence score
   * that ignores the warmup marks the athlete over-distance for running it
   * (`adherence.ts` assumed 1.5–2.5 km). Consolidating the arithmetic should not
   * also silently change what three screens report, so each keeps its answer.
   */
  assumeOpenBlocks?: boolean;
}

// ── Reading numbers out of the coach's own words ─────────────────────────────

/**
 * Minutes stated in a note: "70-80 דק׳" → 4200–4800 s, "60 דק׳" → 3600–3600.
 *
 * This is the only record of the range for a session the parser collapsed to a
 * single `durationValue`, so it is worth more than it looks.
 */
export function minutesRangeFromNotes(notes?: string): Range | null {
  if (!notes) return null;
  const match = notes.match(/(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*(?:דק|דקות|min\b|minutes\b)/i);
  if (!match) return null;
  const low = parseInt(match[1], 10);
  const high = match[2] ? parseInt(match[2], 10) : low;
  if (!low || low > high) return null;
  return { min: low * 60, max: high * 60 };
}

/** Sanity bounds for a pace read out of prose: 2:30/km to 10:00/km. */
const PACE_FLOOR_S = 150;
const PACE_CEIL_S = 600;

/**
 * A pace written in a note: "4:50-5:30" → 290–330 s/km.
 *
 * The club's notation puts the pace in the note as well as in the step's own
 * fields, so this is a fallback for when a parse fills the words and not the
 * numbers. Bounded, because "8 × 0:15" is a set of strides and not a
 * fifteen-second kilometre.
 */
export function paceRangeFromNotes(notes?: string): Range | null {
  if (!notes) return null;
  const match = notes.match(/(\d{1,2}):([0-5]\d)(?:\s*[-–—]\s*(\d{1,2}):([0-5]\d))?/);
  if (!match) return null;
  const low = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const high = match[3] ? parseInt(match[3], 10) * 60 + parseInt(match[4], 10) : low;
  if (low < PACE_FLOOR_S || high > PACE_CEIL_S || low > high) return null;
  return { min: low, max: high };
}

// ── Pace ────────────────────────────────────────────────────────────────────

/** Is this step's distance covered at running effort, or jogged/walked? */
function isRecovery(step: WorkoutStep): boolean {
  return step.type === 'rest' || step.type === 'recovery';
}

/**
 * The pace band to price a step at, and how much that band is worth.
 *
 * A step carrying only ONE side of a range means one pace, not a range: with a
 * bare `|| ASSUMED_PACE.running.max`, a step prescribed at 6:40/km got a max of
 * 6:00/km — a max faster than its min, which inverts every range downstream and
 * reports a min distance larger than the max.
 */
export function stepPaceBand(step: WorkoutStep, opts: EstimateOptions = {}): Estimate {
  if (step.targetPaceMinPerKm || step.targetPaceMaxPerKm) {
    const min = step.targetPaceMinPerKm || step.targetPaceMaxPerKm!;
    const max = step.targetPaceMaxPerKm || step.targetPaceMinPerKm!;
    return { range: { min: Math.min(min, max), max: Math.max(min, max) }, from: 'measured' };
  }
  const stated = paceRangeFromNotes(step.notes);
  if (stated) return { range: stated, from: 'stated' };
  const fallback = isRecovery(step)
    ? opts.recoveryBand || ASSUMED_PACE.recovery
    : opts.easyBand || ASSUMED_PACE.running;
  return { range: { ...fallback }, from: 'assumed' };
}

/**
 * What the week itself says "easy" means, seconds per km.
 *
 * The slowest pace a coach prescribes all week IS their easy pace — so the band
 * to price an unpaced easy run at is the one containing that slowest figure,
 * read off the plan instead of hardcoded. For this club that returns 4:50–5:30
 * where the global default assumes 5:00–6:00, and the difference on a 40-minute
 * evening option is about a kilometre.
 *
 * Widened to at least a 40 s/km spread: a plan written entirely in single paces
 * would otherwise produce an "estimate" with no range in it at all, which is a
 * precision the source does not have.
 */
export function easyPaceBand(workouts: ParsedWorkout[]): Range | null {
  const bands: Range[] = [];
  const visit = (step: WorkoutStep) => {
    for (const sub of step.repeatSteps || []) visit(sub);
    if (isRecovery(step)) return;
    const min = step.targetPaceMinPerKm;
    const max = step.targetPaceMaxPerKm || min;
    if (min && max) bands.push({ min, max });
  };
  for (const workout of workouts) for (const step of workout.steps || []) visit(step);
  if (!bands.length) return null;

  const slowest = Math.max(...bands.map((b) => b.max));
  const min = Math.min(...bands.filter((b) => b.max === slowest).map((b) => b.min));
  return { min, max: Math.max(slowest, min + 40) };
}

/** The options to estimate a whole plan's sessions with, tuned to that plan. */
export function planEstimateOptions(
  workouts: ParsedWorkout[],
  base: EstimateOptions = {},
): EstimateOptions {
  const easyBand = easyPaceBand(workouts);
  return easyBand ? { ...base, easyBand } : base;
}

// ── Time ────────────────────────────────────────────────────────────────────

/**
 * How long a step takes, as a range, in seconds.
 *
 * The note outranks `durationValue` when it states a range that BRACKETS it,
 * because that is the fingerprint of a range collapsed at parse time: Saturday's
 * "40-50 דק׳" is stored as 2700 s, and 45 minutes is a number the coach never
 * wrote. The bracket test is what keeps this from firing on a note whose minutes
 * describe something else — "6 × 90 שניות" inside a 40-minute block does not
 * redefine the block.
 */
export function stepTimeRange(step: WorkoutStep, opts: EstimateOptions = {}): Estimate {
  if (step.repeatCount && step.repeatSteps) {
    let min = 0;
    let max = 0;
    let from: Provenance = 'coach';
    for (const sub of step.repeatSteps) {
      const r = stepTimeRange(sub, opts);
      min += r.range.min;
      max += r.range.max;
      from = weakest(from, r.from);
    }
    return { range: { min: min * step.repeatCount, max: max * step.repeatCount }, from };
  }

  const stated = minutesRangeFromNotes(step.notes);

  if (step.durationType === 'time' && step.durationValue) {
    const value = step.durationValue;
    if (stated && stated.min <= value && value <= stated.max && stated.min !== stated.max) {
      return { range: stated, from: 'stated' };
    }
    return { range: { min: value, max: value }, from: 'measured' };
  }

  if (stated) return { range: stated, from: 'stated' };

  if (step.durationType === 'distance' && step.durationValue) {
    const pace = stepPaceBand(step, opts);
    const km = step.durationValue / 1000;
    return {
      range: { min: Math.round(km * pace.range.min), max: Math.round(km * pace.range.max) },
      from: pace.from === 'assumed' ? 'assumed' : 'derived',
    };
  }

  return NOTHING;
}

// ── Distance ────────────────────────────────────────────────────────────────

/**
 * How far a step covers, as a range, in metres — the multiplication.
 *
 * A faster pace covers MORE ground in the same time, so the fast end of the pace
 * band feeds the far end of the distance: min = shortest time ÷ slowest pace.
 */
export function stepDistanceRange(step: WorkoutStep, opts: EstimateOptions = {}): Estimate {
  if (step.repeatCount && step.repeatSteps) {
    let min = 0;
    let max = 0;
    let from: Provenance = 'coach';
    for (const sub of step.repeatSteps) {
      const r = stepDistanceRange(sub, opts);
      min += r.range.min;
      max += r.range.max;
      from = weakest(from, r.from);
    }
    return { range: { min: min * step.repeatCount, max: max * step.repeatCount }, from };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    return { range: { min: step.durationValue, max: step.durationValue }, from: 'measured' };
  }

  const time = stepTimeRange(step, opts);
  if (time.from !== 'none') {
    const pace = stepPaceBand(step, opts);
    return {
      range: {
        min: Math.round((time.range.min / pace.range.max) * 1000),
        max: Math.round((time.range.max / pace.range.min) * 1000),
      },
      // A multiplication is never better than derived, however good the time
      // was — and it is only as good as the weaker of its two factors, so an
      // assumed pace makes the product assumed.
      from: pace.from === 'assumed' ? 'assumed' : 'derived',
    };
  }

  if (opts.assumeOpenBlocks && (step.type === 'warmup' || step.type === 'cooldown')) {
    return { range: { min: 1500, max: 2500 }, from: 'assumed' };
  }

  return NOTHING;
}

// ── Whole workouts ──────────────────────────────────────────────────────────

function sumSteps(
  workout: ParsedWorkout,
  each: (step: WorkoutStep) => Estimate,
): Estimate {
  let min = 0;
  let max = 0;
  let from: Provenance = 'coach';
  let counted = 0;
  for (const step of workout.steps || []) {
    const r = each(step);
    // A `none` step is skipped rather than dragging the total down to `none`,
    // because most of them are not missing information — they are the zero-length
    // wrapper steps a repeat block hangs off (`durationType: 'time'`,
    // `durationValue: 0`, no notes), and every interval session has several. A
    // step that genuinely should have carried a figure is the pre-flight audit's
    // job to flag, by name, on the session it belongs to.
    if (r.from === 'none') continue;
    min += r.range.min;
    max += r.range.max;
    counted += 1;
    from = weakest(from, r.from);
  }
  if (!counted) return NOTHING;
  return { range: { min, max }, from };
}

/**
 * A session's distance in metres, best source first.
 *
 * The coach's own `distanceMinKm–distanceMaxKm` outranks everything — it is the
 * range printed on the plan, and six of this club's nine weekly sessions have
 * one. It was being averaged into a single figure before it reached the screen,
 * so "11–13 ק״מ" from the PDF was shown to the athlete as "12 ק״מ".
 */
export function workoutDistanceEstimate(
  workout: ParsedWorkout,
  opts: EstimateOptions = {},
): Estimate {
  const low = workout.distanceMinKm;
  const high = workout.distanceMaxKm;
  if (low || high) {
    return {
      range: { min: (low || high || 0) * 1000, max: (high || low || 0) * 1000 },
      from: 'coach',
    };
  }
  return sumSteps(workout, (step) => stepDistanceRange(step, opts));
}

/** A session's duration in seconds. */
export function workoutTimeEstimate(
  workout: ParsedWorkout,
  opts: EstimateOptions = {},
): Estimate {
  return sumSteps(workout, (step) => stepTimeRange(step, opts));
}
