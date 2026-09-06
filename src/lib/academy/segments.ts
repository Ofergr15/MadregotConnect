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
    // `covered > 0` as well as the half-width rule: a zero-width bin satisfies
    // `covered >= 0` with nothing covered at all, and the averages below would
    // then divide 0 by 0 and put NaN into the overlay. Today's only caller
    // coerces a 0-distance split to 1000 m so it can't happen from there, but
    // this is exported as a pure utility for any chart to call.
    if (covered > 0 && covered >= width * 0.5) {
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

// ── "Did they do the workout?" without the watch ────────────────────────────
// matchLapsToSteps below can only answer for a run that WAS the pushed structured
// workout: it needs one lap per planned step, which is what the watch produces
// when it drives the session. Most athletes don't run that way — they read the
// plan and press start — and for them every quality session came back
// `aligned: false`, i.e. "no idea", even when the laps plainly contain the work.
//
// So instead of aligning by position, look for the efforts. A planned set of
// 6×400 m at 3:55–4:05 is a question about the laps as a SET: are there six laps
// about 400 m long, run inside that band? Order doesn't matter, lap count doesn't
// matter, and the warmup, the jog home and a forgotten lap press don't break it.
//
// Two things this must never do. It must not confuse "didn't do the work" with
// "the laps can't show the work": an athlete who never touches the lap button gets
// Garmin's automatic 1 km laps, and no 400 m effort is visible in those at any
// pace, so a requirement with no distance-plausible lap is reported unverifiable
// rather than missed. And it must not confuse "didn't do the rep" with "didn't hit
// the pace" — a rep run fast, or 10 s/km slow, was still run. So each requirement
// reports `attempted` (laps of the right length at a plausible rep pace) beside
// `found` (of those, the ones inside the band), and only zero attempts is a miss.

export interface EffortRequirement {
  label: string;
  /** Target length of one rep in meters (time-based reps converted via target pace). */
  distanceM: number;
  paceMin: number;
  paceMax: number;
  needed: number;
  /** Laps credited as this rep — right length, run at a plausible rep pace. */
  attempted: number;
  /** Of those, how many were inside the pace band. `attempted - found` ran off pace. */
  found: number;
  /** sec/km of the credited laps, in the order they were run. */
  paces: number[];
  /** False when no lap is even close to `distanceM` — the laps can't answer this. */
  verifiable: boolean;
}

export type EffortVerdict = 'confirmed' | 'partial' | 'missed' | 'unverifiable';

export interface EffortReport {
  verdict: EffortVerdict;
  requirements: EffortRequirement[];
  /**
   * Over the verifiable requirements only: reps asked for, reps run, and reps run
   * at target pace. `attemptedTotal > foundTotal` is "did the session, off pace".
   */
  neededTotal: number;
  attemptedTotal: number;
  foundTotal: number;
  lapCount: number;
  /** Typical lap length, for explaining an unverifiable verdict. */
  medianLapM: number | null;
  reason?: 'no_paced_plan' | 'no_laps' | 'laps_too_coarse';
}

/** How far a lap's length may be off the planned rep and still count as that rep. */
const EFFORT_DISTANCE_TOL = 0.2;

/**
 * Longest TIMED block still treated as a rep. Beyond this it's a steady run, not
 * an effort to go looking for: "60 min at 4:40" converts to a 12,973 m
 * requirement that no lap will ever match, and the whole-run pace the adherence
 * engine already grades answers it properly. A rep written in METERS is kept at
 * any length — a 5 km tempo inside a longer run really is one effort — because
 * its length is the plan's number rather than an estimate off an assumed pace.
 */
const MAX_TIMED_REP_SEC = 20 * 60;

/**
 * How much slower than the band's slow edge a lap may be and still be credited as
 * an attempt at that rep. Needed because "did the rep" and "hit the pace" are two
 * different questions — a rep run 15 s/km slow was still run — but crediting by
 * length alone would count the recovery jogs, which in a 10×200 session are laps
 * of exactly 200 m. A recovery is typically 50–100% slower than the rep pace; 25%
 * separates the two without calling a bad rep a rest.
 */
const SLOW_REP_LIMIT = 1.25;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The paced work the plan asks for, as a set of requirements: one entry per
 * distinct (length, pace band) with how many times it's repeated.
 *
 * Time-based reps ("4 min at 3:40") are converted to meters through their own
 * target pace, so a time interval is looked for the same way — the athlete's watch
 * recorded a distance either way.
 */
export function effortRequirements(planned: PlannedSegment[]): EffortRequirement[] {
  const out: EffortRequirement[] = [];
  const byKey = new Map<string, EffortRequirement>();

  for (const seg of planned) {
    if (!seg.graded || !seg.paceMin) continue;
    const paceMin = seg.paceMin;
    const paceMax = seg.paceMax || seg.paceMin;
    const mid = (paceMin + paceMax) / 2;
    const timed = seg.durationSec && seg.durationSec > 0 && seg.durationSec <= MAX_TIMED_REP_SEC;
    const meters =
      seg.distanceM && seg.distanceM > 0
        ? seg.distanceM
        : timed && mid > 0
          ? Math.round((seg.durationSec! * 1000) / mid)
          : 0;
    if (meters <= 0) continue;

    // Round the length for grouping so 400 and 402 are one requirement of two,
    // not two of one.
    const key = `${Math.round(meters / 10)}-${paceMin}-${paceMax}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.needed++;
      continue;
    }
    const requirement: EffortRequirement = {
      label: seg.label,
      distanceM: meters,
      paceMin,
      paceMax,
      needed: 1,
      attempted: 0,
      found: 0,
      paces: [],
      verifiable: false,
    };
    byKey.set(key, requirement);
    out.push(requirement);
  }
  return out;
}

/**
 * Look for the planned efforts among the laps, whatever order they came in.
 *
 * Each lap is spent at most once, on the requirement it fits best, so a single
 * fast kilometre can't satisfy six planned reps. Longest reps are claimed first:
 * a 1000 m lap is a plausible 800 m rep at ±20%, and letting the 800s take it
 * would leave the real 1000 unmatched.
 */
export function findPlannedEfforts(
  planned: PlannedSegment[],
  laps: Lap[],
  paceSec = DEFAULT_TOLERANCES.paceSec,
): EffortReport {
  const requirements = effortRequirements(planned);
  const usable = laps.filter(l => l.distance > 0 && lapPace(l) != null);
  const medianLapM = median(usable.map(l => l.distance));
  const base: EffortReport = {
    verdict: 'unverifiable',
    requirements,
    neededTotal: 0,
    attemptedTotal: 0,
    foundTotal: 0,
    lapCount: laps.length,
    medianLapM,
  };

  if (requirements.length === 0) return { ...base, reason: 'no_paced_plan' };
  // One lap is the whole run — the watch recorded no structure at all.
  if (usable.length < 2) return { ...base, reason: 'no_laps' };

  const spent = new Set<number>();
  for (const requirement of [...requirements].sort((a, b) => b.distanceM - a.distanceM)) {
    const tolerance = requirement.distanceM * EFFORT_DISTANCE_TOL;
    const candidates = usable
      .map((lap, index) => ({ lap, index, pace: lapPace(lap)! }))
      .filter(c => !spent.has(c.index) && Math.abs(c.lap.distance - requirement.distanceM) <= tolerance);
    // Verifiability is about LENGTH alone: if no lap is anywhere near this long,
    // the laps can't show the rep at any pace, and that's not the athlete's fault.
    requirement.verifiable = candidates.length > 0;

    const inBand = (pace: number) =>
      pace >= requirement.paceMin - paceSec && pace <= requirement.paceMax + paceSec;
    const target = (requirement.paceMin + requirement.paceMax) / 2;

    const credited = candidates
      // Too slow to be this rep at all — that's the recovery jog, not a bad rep.
      .filter(c => c.pace <= requirement.paceMax * SLOW_REP_LIMIT)
      // Band first, then closest to its middle: the best evidence for the rep.
      .sort((a, b) => {
        const band = Number(inBand(b.pace)) - Number(inBand(a.pace));
        return band !== 0 ? band : Math.abs(a.pace - target) - Math.abs(b.pace - target);
      })
      .slice(0, requirement.needed)
      // Report them in the order they were actually run.
      .sort((a, b) => a.index - b.index);

    for (const c of credited) spent.add(c.index);
    requirement.attempted = credited.length;
    requirement.found = credited.filter(c => inBand(c.pace)).length;
    requirement.paces = credited.map(c => c.pace);
  }

  const verifiable = requirements.filter(r => r.verifiable);
  if (verifiable.length === 0) return { ...base, reason: 'laps_too_coarse' };

  const neededTotal = verifiable.reduce((sum, r) => sum + r.needed, 0);
  const attemptedTotal = verifiable.reduce((sum, r) => sum + r.attempted, 0);
  const foundTotal = verifiable.reduce((sum, r) => sum + r.found, 0);
  return {
    ...base,
    // 'missed' means no rep was run at all. Reps run off pace are 'partial' — the
    // work happened, and that's a different conversation from skipping it.
    verdict: attemptedTotal === 0 ? 'missed' : foundTotal >= neededTotal ? 'confirmed' : 'partial',
    neededTotal,
    attemptedTotal,
    foundTotal,
  };
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
