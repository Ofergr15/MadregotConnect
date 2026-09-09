import { assessPace, DEFAULT_TOLERANCES, type PaceStatus } from './adherence';
import { lengthLabel } from './segments';
import type { Lane } from './group-lane';
import {
  isRepeatMarker, iterationsByStep, stepPaceBand,
  type ExecutedStep, type ExecutedWorkout,
} from '../garmin/executed-workout';
import type { StoredLap } from '../garmin/laps';
import { isSupportStep, stepRole } from '../plans/graded-steps';

// ── Grading against the workout the watch actually ran ───────────────────────
// The other two engines in here INFER which part of the plan a stretch of running
// was: `gradePlanBlocks` searches the distance axis for the block, and
// `findPlannedEfforts` looks for laps the right length to be the reps. Both exist
// because most runs give us nothing but distance and time, and both are guesses —
// good ones, but a 20 km block placed by search lands ±1 km and a timed block's
// length has to be estimated through the pace the athlete was *supposed* to run.
//
// When the athlete starts a structured workout from the watch, nothing needs
// inferring. Garmin stamps every lap with `wktStepIndex` — the step it executed —
// and `GET /activity/{id}/workouts` returns the step list that index points into.
// The 20 km block is step 1 whether it drifted early or late; eight strides are
// eight laps stamped step 2 at whatever pace they came out; a step the athlete
// skipped is simply absent. 272 runs since July were started this way, so this is
// the club's quality sessions, not an edge case.
//
// The one rule that matters: **both halves must come from the watch.** Reading the
// lap index against our own parsed plan is what this originally did, and it was
// wrong in a way that looked right — one athlete's Sunday came off a workout of
// their own making, a single open 22 km step where the club plan has a 2 km warm-up
// and a 20 km block, and every index still landed in range. The verdict read
// "warm-up: 22 km at 4:46". See `lib/garmin/executed-workout.ts`.
//
// Units: distance METERS, duration SECONDS, pace SECONDS PER KM.

/** Garmin's intensity, in the vocabulary the rest of the academy engine uses. */
const TYPE_OF_INTENSITY: Record<string, string> = {
  WARMUP: 'warmup', COOLDOWN: 'cooldown', INTERVAL: 'interval',
  ACTIVE: 'active', REST: 'rest', RECOVERY: 'recovery', MAIN: 'active',
};

const LABEL_OF_TYPE: Record<string, string> = {
  warmup: 'Warmup', cooldown: 'Cooldown', interval: 'Interval',
  active: 'Run', rest: 'Rest', recovery: 'Recovery',
};

/** One time through a step: the laps the watch stamped with it, run together. */
export interface StepOccurrence {
  /** How many laps make it up — more than one when auto-lap fired inside a long step. */
  laps: number;
  distanceM: number;
  durationSec: number;
  pace: number | null;
  /** Pace with the gradient taken out, when the watch reported it for every lap. */
  gradeAdjustedPace: number | null;
  averageHR: number | null;
  status: PaceStatus;
}

export interface WatchStepVerdict {
  /** The watch's own step number — what `wktStepIndex` on a lap points at. */
  index: number;
  type: string;
  label: string;
  graded: boolean;
  /** The coach's text for this step, verbatim. Usually where the target came from. */
  notes: string | null;
  plannedPaceMin: number | null;
  plannedPaceMax: number | null;
  plannedDistanceM: number | null;
  plannedDurationSec: number | null;
  plannedRepeats: number;
  /** Times the athlete actually ran it. Fewer than planned is a set cut short. */
  ranRepeats: number;
  actualDistanceM: number;
  actualDurationSec: number;
  actualPace: number | null;
  gradeAdjustedPace: number | null;
  averageHR: number | null;
  /** Over everything run against this step together. */
  status: PaceStatus;
  /** Of `ranRepeats`, how many were inside the band on their own. */
  onTargetRepeats: number;
  /** True when the step was cut short — under 90% of what it asked for. */
  truncated: boolean;
  occurrences: StepOccurrence[];
}

export interface WatchStepReport {
  /** The workout's name on the watch — not necessarily the plan's name for the day. */
  workoutName: string | null;
  steps: WatchStepVerdict[];
  gradedCount: number;
  onTargetCount: number;
  /**
   * Rep counts over the repeated WORK steps — the rests are not a question anyone asks.
   *
   * `repeatsRun` deliberately counts reps with no pace target too: most of the club's
   * rep sets are strides the coach wrote without one, and "did you do the eight
   * strides" is the question about them. `repeatsOnTarget` is out of
   * `repeatsWithTarget`, not out of `repeatsRun`, so an untargeted set doesn't read as
   * eight reps missed.
   */
  repeatsPlanned: number;
  repeatsRun: number;
  repeatsWithTarget: number;
  repeatsOnTarget: number;
  /** Laps with no step index — the jog to the start, a forgotten stop. */
  unstampedLaps: number;
  /** True when every step of the workout was run at least once. */
  complete: boolean;
}

/**
 * A step is "cut short" below this fraction of its planned length. The athlete who
 * stopped 400 m into a 10 km block did not run a 400 m block at whatever pace those
 * 400 m came out at, and a verdict must not read as though they did.
 */
const TRUNCATED_BELOW = 0.9;

/**
 * How many stamped lap groups may point outside the step list before the whole mapping
 * is refused. With both halves coming from the watch this should be none; a payload
 * where it isn't is one we've misread, and the distance search is right there.
 */
const MAX_UNMAPPED_FRAC = 0.25;

const paceOf = (distanceM: number, durationSec: number): number | null =>
  distanceM > 0 && durationSec > 0 ? Math.round(durationSec / (distanceM / 1000)) : null;

/** Consecutive laps carrying the same step index — one time through that step. */
export function groupLapsByStep(laps: StoredLap[]): { stepIndex: number; laps: StoredLap[] }[] {
  const out: { stepIndex: number; laps: StoredLap[] }[] = [];
  for (const lap of laps) {
    if (lap.wktStepIndex == null) continue;
    const last = out[out.length - 1];
    if (last && last.stepIndex === lap.wktStepIndex) last.laps.push(lap);
    else out.push({ stepIndex: lap.wktStepIndex, laps: [lap] });
  }
  return out;
}

/** Roll a set of laps up into one occurrence of a step. */
function occurrenceOf(
  laps: StoredLap[],
  band: { min: number; max: number } | null,
  paceSec: number,
): StepOccurrence {
  let distanceM = 0, durationSec = 0, hrSeconds = 0, hrDuration = 0, gapSeconds = 0, gapMeters = 0;
  for (const lap of laps) {
    distanceM += lap.distance;
    durationSec += lap.duration;
    if (lap.averageHR != null) { hrSeconds += lap.averageHR * lap.duration; hrDuration += lap.duration; }
    // Distance-weighted, and only when every lap has it: a mean over half the laps is
    // not the step's grade-adjusted pace, it's the pace of the half that had one.
    if (lap.gradeAdjustedPace != null && lap.distance > 0) {
      gapSeconds += (lap.gradeAdjustedPace * lap.distance) / 1000;
      gapMeters += lap.distance;
    }
  }
  const pace = paceOf(distanceM, durationSec);
  return {
    laps: laps.length,
    distanceM: Math.round(distanceM),
    durationSec: Math.round(durationSec),
    pace,
    gradeAdjustedPace: gapMeters > 0 && gapMeters >= distanceM * 0.99
      ? Math.round(gapSeconds / (gapMeters / 1000))
      : null,
    averageHR: hrDuration > 0 ? Math.round(hrSeconds / hrDuration) : null,
    status: band ? assessPace(pace, band.min, band.max, paceSec) : 'unknown',
  };
}

function labelFor(step: ExecutedStep, type: string): string {
  const base = LABEL_OF_TYPE[type] || type;
  const length = lengthLabel(step.distanceM, step.durationSec);
  return length ? `${base} ${length}` : base;
}

/**
 * Grade a run against the workout its watch was driving, step by step.
 *
 * `lane` is the athlete's pace lane, because the target usually arrives as the coach's
 * own note — "4:25 (4:35) ((4:45))" is three lanes, and grading a lane-3 athlete
 * against 4:25 is worse than not grading them.
 *
 * Returns null — so the caller falls back to `gradePlanBlocks` / `findPlannedEfforts` —
 * when no lap carries a step index, or when the indices don't fit the step list.
 */
export function gradeWatchSteps(
  workout: ExecutedWorkout | null,
  laps: StoredLap[],
  lane: Lane,
  paceSec = DEFAULT_TOLERANCES.paceSec,
): WatchStepReport | null {
  if (!workout) return null;
  const steps = workout.steps.filter(s => !isRepeatMarker(s));
  if (steps.length === 0) return null;

  const groups = groupLapsByStep(laps);
  if (groups.length === 0) return null;

  const declared = new Set(steps.map(s => s.stepIndex));
  const unmapped = groups.filter(g => !declared.has(g.stepIndex)).length;
  if (unmapped > groups.length * MAX_UNMAPPED_FRAC) return null;

  const byStep = new Map<number, StoredLap[][]>();
  for (const g of groups) {
    if (!declared.has(g.stepIndex)) continue;
    const list = byStep.get(g.stepIndex);
    if (list) list.push(g.laps);
    else byStep.set(g.stepIndex, [g.laps]);
  }

  const iterations = iterationsByStep(workout);

  const verdicts: WatchStepVerdict[] = steps.map(step => {
    const type = TYPE_OF_INTENSITY[step.intensity || ''] || 'active';
    const band = stepPaceBand(step, lane);
    const repeats = iterations.get(step.stepIndex) ?? 1;
    const occurrenceLaps = byStep.get(step.stepIndex) || [];
    const occurrences = occurrenceLaps.map(ls => occurrenceOf(ls, band, paceSec));
    const total = occurrenceOf(occurrenceLaps.flat(), band, paceSec);

    // Compare against the axis the workout named: a step written in time is judged on
    // whether the athlete ran it for that long, not on the metres it produced.
    const plannedDistance = step.distanceM ? step.distanceM * repeats : null;
    const plannedDuration = step.durationSec ? step.durationSec * repeats : null;
    const truncated = occurrences.length === 0
      || (plannedDuration != null
        ? total.durationSec < plannedDuration * TRUNCATED_BELOW
        : plannedDistance != null
          ? total.distanceM < plannedDistance * TRUNCATED_BELOW
          // An OPEN step asked for nothing measurable, so nothing about it is short.
          : false);

    return {
      index: step.stepIndex,
      type,
      label: labelFor(step, type),
      graded: band != null,
      notes: step.notes ?? null,
      plannedPaceMin: band?.min ?? null,
      plannedPaceMax: band?.max ?? null,
      plannedDistanceM: plannedDistance,
      plannedDurationSec: plannedDuration,
      plannedRepeats: repeats,
      ranRepeats: occurrences.length,
      actualDistanceM: total.distanceM,
      actualDurationSec: total.durationSec,
      actualPace: total.pace,
      gradeAdjustedPace: total.gradeAdjustedPace,
      averageHR: total.averageHR,
      status: total.status,
      onTargetRepeats: occurrences.filter(o => o.status === 'on_target').length,
      truncated,
      occurrences,
    };
  });

  const graded = verdicts.filter(v => v.graded);
  const repeated = verdicts.filter(v => v.plannedRepeats > 1 && stepRole(v) !== 'rest');
  const targeted = repeated.filter(v => v.graded);
  return {
    workoutName: workout.name,
    steps: verdicts,
    gradedCount: graded.length,
    onTargetCount: graded.filter(v => v.status === 'on_target').length,
    repeatsPlanned: repeated.reduce((n, v) => n + v.plannedRepeats, 0),
    repeatsRun: repeated.reduce((n, v) => n + v.ranRepeats, 0),
    repeatsWithTarget: targeted.reduce((n, v) => n + v.ranRepeats, 0),
    repeatsOnTarget: targeted.reduce((n, v) => n + v.onTargetRepeats, 0),
    unstampedLaps: laps.filter(l => l.wktStepIndex == null).length,
    complete: verdicts.every(v => v.ranRepeats > 0),
  };
}

/**
 * The one step whose pace answers "did you run this session at the pace you were asked
 * to". Mirrors `dominantBlock`: the longest stretch of actual WORK, never the warm-up
 * (a session's average is not its target, and neither is its warm-up), and never a step
 * the athlete cut short.
 */
export function dominantWatchStep(report: WatchStepReport): WatchStepVerdict | null {
  return report.steps
    .filter(v => v.graded && v.status !== 'unknown' && !v.truncated && !isSupportStep(v))
    .sort((a, b) => b.actualDistanceM - a.actualDistanceM)[0] || null;
}

/** How much of what a step asked for was run, on the axis the step was written in. */
export function stepRanFraction(step: WatchStepVerdict): number | null {
  if (step.plannedDurationSec) return step.actualDurationSec / step.plannedDurationSec;
  if (step.plannedDistanceM) return step.actualDistanceM / step.plannedDistanceM;
  // An open step asked for nothing measurable, so no fraction of it exists.
  return null;
}

/**
 * How much of a cut-short step has to have been run for the pace over it to be that
 * step's pace, rather than the pace of the easy first piece of it that everybody holds.
 * A third: enough to be into the work, and nowhere near enough to read as having done it.
 */
const PARTIAL_STEP_MIN = 1 / 3;

/**
 * And how much of the run the step has to be, so that the pace row is about the run the
 * athlete went out on. Four of eight strides is half a step and 400 m of a 15 km run —
 * it clears the bar above and fails this one, which is why the two are separate numbers.
 */
const PARTIAL_RUN_MIN = 0.5;

/**
 * The step to report a pace for when the run ended mid-session, so every step
 * `dominantWatchStep` would pick was cut short.
 *
 * This exists because withholding was worse than answering. An athlete sent out for 2 km
 * easy plus 20 km at 4:35 who stopped at 15 km got a dashed accuracy ring and a pace row
 * pairing the run's 4:45 average with the 4:35 band under "nothing to compare" — while
 * the watch's own step list said the 10 km of the block he did run came out at 4:35, on
 * target. The honest reading is "you held the pace and you stopped 8 km early", and the
 * distance row, the direction and the headline all say the second half of it.
 *
 * That is also what makes grading a fragment safe rather than generous: distance and
 * duration are two thirds of the metrics and both collapse on a run cut short, so the
 * pace can lift the score but never carry it. What the two thresholds prevent is the
 * pace row being about something other than the session — a stride set, or the first
 * kilometre of a block nobody got into.
 *
 * Deliberately NOT part of `dominantWatchStep`: a truncated step must never take the
 * place of a verdict a complete one could give, so this is only consulted after both
 * `dominantWatchStep` and `dominantBlock` come back empty (see `resolveDominantPace`),
 * and it always travels with `truncated: true` so every surface can say what it is.
 */
export function partialWatchStep(report: WatchStepReport): WatchStepVerdict | null {
  const ran = report.steps.reduce((sum, v) => sum + v.actualDistanceM, 0);
  return report.steps
    .filter(v => v.graded && v.status !== 'unknown' && v.truncated && !isSupportStep(v)
      && (stepRanFraction(v) ?? 0) >= PARTIAL_STEP_MIN
      && v.actualDistanceM >= ran * PARTIAL_RUN_MIN)
    .sort((a, b) => b.actualDistanceM - a.actualDistanceM)[0] || null;
}
