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
