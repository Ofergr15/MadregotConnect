/**
 * Per-kilometre splits, from the laps a run actually stored.
 *
 * The `splits` column was meant to hold these, written by
 * `/api/garmin/activity-details` — but nothing calls that route any more, so 589
 * of the club's last 595 runs have no splits at all and the detail screen falls
 * back to the laps. That fallback then labels each lap a kilometre, which on a
 * workout run is badly wrong: Garmin presses a lap per STEP, so one 15-second
 * stride sat in the chart beside a 1 km lap under the label "km 14", and the card
 * said "0 of 31 kilometres in the band" about a 15 km run.
 *
 * So the laps are re-binned onto the kilometre grid the UI claims to draw. A run
 * that auto-lapped every kilometre comes out unchanged (that is the common case,
 * and the bins are then exactly the laps); a run lapped by workout step comes out
 * as the kilometres it was, with the pace of each kilometre averaged across the
 * laps that fell inside it.
 *
 * Units, as everywhere: distance METERS, duration SECONDS, pace SECONDS PER KM.
 */

import type { StoredLap } from '@/lib/plan-execution/laps';

/**
 * One kilometre of a run. Structurally the `Split` the activity UI renders
 * (`components/activity/types.ts`) — kept as its own name here because this
 * module has no business importing a component's types.
 */
export interface KmSplit {
  distance: number;
  duration: number;
  averagePace: number;
  averageHR: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
}

const BIN_METERS = 1000;

/**
 * A trailing stretch shorter than this is folded into the last full kilometre
 * instead of becoming a bin of its own. Garmin shows the remainder as a partial
 * split, and so do we — but the 9 m left over from a 15,009 m run is not a data
 * point, it's a rounding artefact whose "pace" would rescale the whole chart.
 */
const MIN_TRAILING_METERS = 200;

interface Bin {
  distance: number;
  duration: number;
  elevationGain: number | null;
  elevationLoss: number | null;
  /** Distance-weighted HR sum, and the distance it covers — laps without HR are
   *  left out of both, so one unmonitored lap doesn't drag the average down. */
  hrSum: number;
  hrDistance: number;
}

function emptyBin(): Bin {
  return { distance: 0, duration: 0, elevationGain: null, elevationLoss: null, hrSum: 0, hrDistance: 0 };
}

/** Adds a share of one lap — `meters` of it — to a bin, pro rata. */
function pour(bin: Bin, lap: StoredLap, meters: number): void {
  const share = meters / lap.distance;
  bin.distance += meters;
  bin.duration += lap.duration * share;
  if (lap.elevationGain != null) bin.elevationGain = (bin.elevationGain ?? 0) + lap.elevationGain * share;
  if (lap.elevationLoss != null) bin.elevationLoss = (bin.elevationLoss ?? 0) + lap.elevationLoss * share;
  if (lap.averageHR != null) {
    bin.hrSum += lap.averageHR * meters;
    bin.hrDistance += meters;
  }
}

function seal(bin: Bin): KmSplit {
  return {
    distance: Math.round(bin.distance),
    duration: Math.round(bin.duration),
    // Per KM even for a partial trailing bin, so every point on the chart is the
    // same measurement and a 600 m finish doesn't read as a 3-minute kilometre.
    averagePace: Math.round(bin.duration / (bin.distance / BIN_METERS)),
    averageHR: bin.hrDistance > 0 ? Math.round(bin.hrSum / bin.hrDistance) : null,
    elevationGain: bin.elevationGain == null ? null : Math.round(bin.elevationGain),
    elevationLoss: bin.elevationLoss == null ? null : Math.round(bin.elevationLoss),
  };
}

/** Merges a short trailing stretch back into the kilometre before it. */
function foldInto(previous: KmSplit, tail: Bin): KmSplit {
  const distance = previous.distance + tail.distance;
  const duration = previous.duration + tail.duration;
  const hrDistance = (previous.averageHR != null ? previous.distance : 0) + tail.hrDistance;
  const hrSum = (previous.averageHR != null ? previous.averageHR * previous.distance : 0) + tail.hrSum;
  return {
    distance: Math.round(distance),
    duration: Math.round(duration),
    averagePace: Math.round(duration / (distance / BIN_METERS)),
    averageHR: hrDistance > 0 ? Math.round(hrSum / hrDistance) : null,
    elevationGain: sum(previous.elevationGain, tail.elevationGain),
    elevationLoss: sum(previous.elevationLoss, tail.elevationLoss),
  };
}

function sum(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Math.round((a ?? 0) + (b ?? 0));
}

export function kmSplitsFromLaps(laps: StoredLap[]): KmSplit[] {
  const splits: KmSplit[] = [];
  let bin = emptyBin();

  for (const lap of laps) {
    let left = lap.distance;
    while (left > 0) {
      const room = BIN_METERS - bin.distance;
      const meters = Math.min(room, left);
      pour(bin, lap, meters);
      left -= meters;
      // `>= room` rather than `=== BIN_METERS`: floating-point pours land a
      // hair short and would leave a 0.0001 m bin open forever.
      if (bin.distance >= BIN_METERS - 1e-6) {
        splits.push(seal(bin));
        bin = emptyBin();
      }
    }
  }

  if (bin.distance >= MIN_TRAILING_METERS) {
    splits.push(seal(bin));
  } else if (bin.distance > 0 && splits.length) {
    splits[splits.length - 1] = foldInto(splits[splits.length - 1], bin);
  } else if (bin.distance > 0) {
    // A run shorter than the fold threshold is all there is — better a 150 m
    // split than an empty chart.
    splits.push(seal(bin));
  }

  return splits;
}
