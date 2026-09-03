/**
 * Collapse repetitive lap sequences (e.g. 6 × [0:30 fast / 1:00 walk]) into
 * repeat blocks so the laps card and the reverse-engineered plan do not list
 * every rep. Pure functions over Strava-shaped laps.
 */

import type { StravaLap } from '@/lib/strava/client';

export interface LapStepSummary {
  /** Position inside the repeating pattern (0 = first step). */
  position: number;
  count: number;
  /** Nominal duration/distance: the median of the reps (robust to one bad lap). */
  durationSec: number;
  distanceM: number;
  /** Aggregate pace across all reps of this step, sec/km. */
  paceSecPerKm: number | null;
  averageHr: number | null;
  /** 1-based lap numbers covered by this step. */
  lapNumbers: number[];
  laps: StravaLap[];
}

export type LapBlock =
  | { kind: 'lap'; lapNumber: number; lap: StravaLap }
  | {
      kind: 'repeat';
      reps: number;
      /** 1-based inclusive lap range. */
      fromLap: number;
      toLap: number;
      steps: LapStepSummary[];
    };

export interface GroupLapsOptions {
  /** Minimum repetitions before a pattern is collapsed. */
  minReps?: number;
  /** Pattern lengths to try, longest first wins on coverage. */
  periods?: number[];
}

const DURATION_TOL = { floor: 2, ratio: 0.05 };
const DISTANCE_TOL = { floor: 12, ratio: 0.05 };
const PACE_TOL = { floor: 12, ratio: 0.12 };

function within(a: number, b: number, tol: { floor: number; ratio: number }): boolean {
  return Math.abs(a - b) <= Math.max(tol.floor, tol.ratio * Math.max(a, b));
}

export function lapPaceSecPerKm(lap: Pick<StravaLap, 'distance' | 'moving_time' | 'average_speed'>): number | null {
  if (lap.average_speed > 0) return 1000 / lap.average_speed;
  if (lap.distance > 0 && lap.moving_time > 0) return lap.moving_time / (lap.distance / 1000);
  return null;
}

/**
 * Two laps are the same "step" when they were cut by the same rule: same
 * button/auto-lap time or same auto-lap distance. Pace only matters for
 * single-step patterns, where it separates "10 × 1 km" from a progression run.
 */
export function lapsMatch(a: StravaLap, b: StravaLap, requirePace = false): boolean {
  const sameDuration = within(a.moving_time, b.moving_time, DURATION_TOL);
  const sameDistance = within(a.distance, b.distance, DISTANCE_TOL);
  if (!sameDuration && !sameDistance) return false;
  if (!requirePace) return true;
  const pa = lapPaceSecPerKm(a);
  const pb = lapPaceSecPerKm(b);
  if (pa == null || pb == null) return false;
  return within(pa, pb, PACE_TOL);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeStep(position: number, laps: StravaLap[], lapNumbers: number[]): LapStepSummary {
  const totalDistance = laps.reduce((sum, lap) => sum + lap.distance, 0);
  const totalTime = laps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const hrLaps = laps.filter((lap) => typeof lap.average_heartrate === 'number' && lap.average_heartrate! > 0);
  const hrWeight = hrLaps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const averageHr = hrLaps.length && hrWeight
    ? hrLaps.reduce((sum, lap) => sum + lap.average_heartrate! * lap.moving_time, 0) / hrWeight
    : null;
  return {
    position,
    count: laps.length,
    durationSec: median(laps.map((lap) => lap.moving_time)),
    distanceM: median(laps.map((lap) => lap.distance)),
    paceSecPerKm: totalDistance > 0 && totalTime > 0 ? totalTime / (totalDistance / 1000) : null,
    averageHr,
    lapNumbers,
    laps,
  };
}

/** How many consecutive repetitions of the `period`-long pattern start at `start`. */
function countReps(laps: StravaLap[], start: number, period: number): number {
  let reps = 1;
  while (true) {
    const base = start + reps * period;
    if (base + period > laps.length) break;
    let matches = true;
    for (let j = 0; j < period; j += 1) {
      if (!lapsMatch(laps[start + j], laps[base + j], period === 1)) {
        matches = false;
        break;
      }
    }
    if (!matches) break;
    reps += 1;
  }
  return reps;
}

export function groupLaps(laps: StravaLap[], options: GroupLapsOptions = {}): LapBlock[] {
  const minReps = options.minReps ?? 3;
  const periods = options.periods ?? [2, 3, 1];
  const blocks: LapBlock[] = [];
  let i = 0;

  while (i < laps.length) {
    let best: { period: number; reps: number } | null = null;
    for (const period of periods) {
      if (i + period * minReps > laps.length) continue;
      // A multi-step pattern must actually alternate; otherwise it is really
      // a single-step pattern and should be judged with the pace rule.
      if (period > 1) {
        const distinct = laps.slice(i, i + period).some((lap, j, arr) => j > 0 && !lapsMatch(arr[0], lap, true));
        if (!distinct) continue;
      }
      const reps = countReps(laps, i, period);
      if (reps < minReps) continue;
      if (!best || reps * period > best.reps * best.period) best = { period, reps };
    }

    if (!best) {
      blocks.push({ kind: 'lap', lapNumber: i + 1, lap: laps[i] });
      i += 1;
      continue;
    }

    const { period, reps } = best;
    const steps: LapStepSummary[] = [];
    for (let j = 0; j < period; j += 1) {
      const stepLaps: StravaLap[] = [];
      const numbers: number[] = [];
      for (let r = 0; r < reps; r += 1) {
        const index = i + r * period + j;
        stepLaps.push(laps[index]);
        numbers.push(index + 1);
      }
      steps.push(summarizeStep(j, stepLaps, numbers));
    }
    blocks.push({ kind: 'repeat', reps, fromLap: i + 1, toLap: i + reps * period, steps });
    i += reps * period;
  }

  return blocks;
}
