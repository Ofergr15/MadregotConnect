import { ParsedWorkout, WorkoutStep } from '../ai/types';
import { assessPace, PaceStatus, DEFAULT_TOLERANCES } from './adherence';

// ── Per-segment planned-vs-actual verdicts ──────────────────────────────────
// Flatten a planned workout into an ordered list of executable steps (expanding
// repeats), align them to the actual laps a Garmin watch recorded (one lap per
// step when a pushed structured workout is run), and grade each step's pace.
//
// Units: distance METERS, duration SECONDS, pace SECONDS PER KM.

export interface PlannedSegment {
  index: number;
  type: WorkoutStep['type'];
  label: string;          // e.g. "Interval 400m" / "Rest"
  distanceM?: number;     // planned distance if known
  durationSec?: number;   // planned duration if time-based
  paceMin?: number;       // sec/km fastest planned pace
  paceMax?: number;       // sec/km slowest planned pace
  graded: boolean;        // false for rest/recovery/no-pace — shown but not scored
}

export interface Lap {
  distance: number;         // meters
  duration: number;         // seconds
  averagePace?: number | null; // sec/km (may be derived if absent)
}

export interface SegmentVerdict {
  index: number;
  type: string;
  label: string;
  plannedPaceMin: number | null;
  plannedPaceMax: number | null;
  actualPace: number | null;   // sec/km
  actualDistanceM: number | null;
  status: PaceStatus;          // on_target | faster | slower | unknown
  graded: boolean;
}

export interface SegmentReport {
  aligned: boolean;            // did lap count line up with planned steps?
  segments: SegmentVerdict[];
  gradedCount: number;
  onTargetCount: number;
  reason?: string;             // when not aligned, why
}

const STEP_LABEL: Record<string, string> = {
  warmup: 'Warmup', cooldown: 'Cooldown', interval: 'Interval',
  active: 'Run', rest: 'Rest', recovery: 'Recovery',
};

function segLabel(step: WorkoutStep): string {
  const base = STEP_LABEL[step.type] || step.type;
  if (step.durationType === 'distance' && step.durationValue) {
    const m = step.durationValue;
    return `${base} ${m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)}km` : `${m}m`}`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    return `${base} ${Math.round(step.durationValue / 60)}min`;
  }
  return base;
}

/** Ordered, repeat-EXPANDED list of executable steps (the leaf run order). */
export function flattenPlannedSteps(workout: ParsedWorkout): PlannedSegment[] {
  const out: PlannedSegment[] = [];
  const walk = (steps: WorkoutStep[]) => {
    for (const s of steps) {
      if (s.repeatCount && s.repeatSteps && s.repeatSteps.length) {
        for (let i = 0; i < s.repeatCount; i++) walk(s.repeatSteps);
      } else {
        const isPace = s.targetType === 'pace' && !!s.targetPaceMinPerKm;
        const isRest = s.type === 'rest' || s.type === 'recovery';
        out.push({
          index: out.length,
          type: s.type,
          label: segLabel(s),
          distanceM: s.durationType === 'distance' ? s.durationValue : undefined,
          durationSec: s.durationType === 'time' ? s.durationValue : undefined,
          paceMin: s.targetPaceMinPerKm,
          paceMax: s.targetPaceMaxPerKm || s.targetPaceMinPerKm,
          graded: isPace && !isRest,
        });
      }
    }
  };
  walk(workout.steps);
  return out;
}

function lapPace(lap: Lap): number | null {
  if (lap.averagePace != null) return lap.averagePace;
  if (lap.distance > 0 && lap.duration > 0) return Math.round(lap.duration / (lap.distance / 1000));
  return null;
}

// ── Planned pace bands + chart-overlay projection ───────────────────────────
// The activity chart plots ACTUAL pace, one point per recorded split. Splits are
// NOT always 1km — an interval workout auto-laps per step (e.g. 630m fast, 131m
// slow). So to overlay the PLAN honestly we lay the planned steps out on a METER
// timeline as pace bands, then project those bands onto whatever distance bins
// the chart actually uses (the splits' cumulative ranges). Fast/slow planned
// segments then line up with the real fast/slow laps regardless of split size.

// A paced stretch of the plan on the meter timeline. sec/km; smaller = faster.
export interface PlannedBand {
  startM: number;
  endM: number;
  min: number; // fastest planned pace across this stretch
  max: number; // slowest planned pace across this stretch
}

// A planned point aligned to one chart bin (or null = no paced plan there).
export interface PlannedKmPoint {
  pace: number; // sec/km — band midpoint, for the center line
  min: number;  // sec/km — fastest
  max: number;  // sec/km — slowest
}

// Flatten the workout onto a meter timeline of paced bands. Distance steps use
// their meters; time steps estimate meters from target pace (m = s * 1000/pace);
// steps with no placeable length are skipped. Rests advance the cursor but add
// no band (leaving a gap the overlay honours).
export function buildPlannedBands(workout: ParsedWorkout): PlannedBand[] {
  const flat = flattenPlannedSteps(workout);
  const bands: PlannedBand[] = [];
  let cursor = 0;
  for (const seg of flat) {
    const mid = seg.paceMin && seg.paceMax ? (seg.paceMin + seg.paceMax) / 2 : (seg.paceMin || 0);
    let meters = 0;
    if (seg.distanceM && seg.distanceM > 0) meters = seg.distanceM;
    else if (seg.durationSec && seg.durationSec > 0 && mid > 0) meters = (seg.durationSec * 1000) / mid;
    if (meters <= 0) continue;
    const startM = cursor;
    cursor += meters;
    if (seg.graded && seg.paceMin) {
      bands.push({ startM, endM: cursor, min: seg.paceMin, max: seg.paceMax || seg.paceMin });
    }
  }
  return bands;
}

/**
 * True when a plan is one continuous run rather than a set of reps — i.e. whether
 * a per-kilometre chart of it is honest.
 *
 * Because `projectBandsToBins` below hands a bin the band that covers half of it,
 * the kilometre of a 4×2000 that straddles a rep and its 400 m recovery jog gets
 * drawn against the rep's band while the pace plotted on it includes the jog: a
 * rep the athlete nailed reads a minute per km slow. A continuous run has no such
 * seam — each bin's pace and each bin's band describe the same stretch of running.
 *
 * Read off the STEPS, deliberately, and not off the bands: a rest written as
 * "2 min" carries no pace, so `buildPlannedBands` can place no metres for it and
 * the four reps of a 4×2000 come back touching. By the bands alone that plan
 * looks perfectly continuous.
 *
 * Unpaced steps BEFORE the first target and after the last are not seams — a
 * warmup jog or a walk home just leaves those bins null.
 */
export function isContinuousPlan(workout: ParsedWorkout): boolean {
  const flat = flattenPlannedSteps(workout);
  const first = flat.findIndex((seg) => seg.graded);
  if (first < 0) return false;
  const last = flat.reduce((acc, seg, i) => (seg.graded ? i : acc), -1);
  // Any ungraded step in between is a stretch the plan set no pace for, whose
  // metres a neighbouring band would silently absorb: a rest, a recovery, or an
  // untargeted middle section. All three break the km frame the same way.
  for (let i = first; i <= last; i++) if (!flat[i].graded) return false;
  return true;
}

// Project paced bands onto ordered distance bins (meters each). Returns one point
// per bin, overlap-weighted; a bin less than half-covered by any paced band → null
// (the overlay breaks rather than drawing a value it can't justify). Pure &
// client-safe so the chart can call it directly.
export function projectBandsToBins(bands: PlannedBand[], binMeters: number[]): (PlannedKmPoint | null)[] {
  if (bands.length === 0) return binMeters.map(() => null);
  const out: (PlannedKmPoint | null)[] = [];
  let lo = 0;
  for (const width of binMeters) {
    const hi = lo + width;
    let covered = 0, wMin = 0, wMax = 0;
    for (const b of bands) {
      const os = Math.max(lo, b.startM);
      const oe = Math.min(hi, b.endM);
      const overlap = oe - os;
      if (overlap > 0) { covered += overlap; wMin += b.min * overlap; wMax += b.max * overlap; }
    }
    if (covered >= width * 0.5) {
      const min = Math.round(wMin / covered);
      const max = Math.round(wMax / covered);
      out.push({ pace: Math.round((min + max) / 2), min, max });
    } else {
      out.push(null);
    }
    lo = hi;
  }
  return out;
}

/**
 * Align laps to planned steps positionally and grade each. Requires the lap count
 * to match the planned step count (Garmin auto-laps per step). If they don't line
 * up we return aligned:false with unknown verdicts — never a wrong color.
 */
export function matchLapsToSteps(
  planned: PlannedSegment[],
  laps: Lap[],
  paceSec = DEFAULT_TOLERANCES.paceSec
): SegmentReport {
  const aligned = laps.length === planned.length && planned.length > 0;

  const segments: SegmentVerdict[] = planned.map((p, i) => {
    const lap = aligned ? laps[i] : undefined;
    const actualPace = lap ? lapPace(lap) : null;
    const status: PaceStatus = aligned && p.graded
      ? assessPace(actualPace, p.paceMin, p.paceMax, paceSec)
      : 'unknown';
    return {
      index: p.index,
      type: p.type,
      label: p.label,
      plannedPaceMin: p.paceMin ?? null,
      plannedPaceMax: p.paceMax ?? null,
      actualPace,
      actualDistanceM: lap ? lap.distance : null,
      status,
      graded: p.graded,
    };
  });

  const graded = segments.filter(s => s.graded);
  return {
    aligned,
    segments,
    gradedCount: graded.length,
    onTargetCount: graded.filter(s => s.status === 'on_target').length,
    reason: aligned ? undefined
      : planned.length === 0 ? 'no planned steps'
      : laps.length === 0 ? 'no lap data (workout not run on watch as a structured workout)'
      : `lap count (${laps.length}) does not match planned steps (${planned.length})`,
  };
}
