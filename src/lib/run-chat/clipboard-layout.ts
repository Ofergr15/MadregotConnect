/**
 * Pure layout for the Garmin-clipboard intensity strip.
 *
 * Bar widths are proportional to the *work* each step represents, expressed
 * in metres. Distance steps use their distance; time steps are converted via
 * their target pace (or a per-kind default); open-ended steps ("Lap Button
 * Press", unspecified rest) fall back to a nominal size. Every bar keeps a
 * minimum visible width, and the strip always fills exactly `totalWidth`.
 */

import type { WorkoutSegment, WorkoutSegmentKind } from './mock-workout';

export interface IntensityBar {
  step: WorkoutSegment;
  x: number;
  width: number;
}

export interface IntensityLayoutOptions {
  /** Space between bars in px. Drops to 0 when the strip is too crowded. */
  gap?: number;
  /** Smallest bar width in px so tiny rests stay visible. */
  minWidth?: number;
}

/** Seconds per km used to turn time-based steps into a comparable distance. */
const DEFAULT_PACE_SEC: Record<WorkoutSegmentKind, number> = {
  warmup: 360,
  cooldown: 360,
  easy: 330,
  interval: 240,
  recovery: 420,
  rest: 420,
  repeat: 300,
};

/** Nominal size for steps with neither distance nor duration. */
const FALLBACK_METERS: Record<WorkoutSegmentKind, number> = {
  warmup: 1500,
  cooldown: 1500,
  easy: 1000,
  interval: 400,
  recovery: 200,
  rest: 200,
  repeat: 0,
};

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Work a single step represents, in metres. */
export function stepWeightMeters(step: WorkoutSegment): number {
  if (finitePositive(step.distanceM)) return step.distanceM;
  if (finitePositive(step.durationSec)) {
    const pace = finitePositive(step.targetPaceSec)
      ? step.targetPaceSec
      : DEFAULT_PACE_SEC[step.kind] ?? 300;
    return (step.durationSec / pace) * 1000;
  }
  return FALLBACK_METERS[step.kind] ?? 500;
}

/** Steps drawn in the strip: everything except the Repeat header row. */
export function intensitySteps(steps: WorkoutSegment[]): WorkoutSegment[] {
  return steps.filter((step) => step.kind !== 'repeat');
}

/**
 * Distribute `available` px across weights, clamping each to `minWidth` and
 * shrinking the rest proportionally so the total stays exact.
 */
function distribute(weights: number[], available: number, minWidth: number): number[] {
  const count = weights.length;
  if (!count) return [];
  const floor = Math.min(minWidth, available / count);
  const widths = new Array<number>(count).fill(floor);
  const pinned = new Set<number>();

  for (let pass = 0; pass < count + 1; pass += 1) {
    const flexIndices = weights.map((_, i) => i).filter((i) => !pinned.has(i));
    const flexWeight = flexIndices.reduce((sum, i) => sum + weights[i], 0);
    const flexSpace = available - pinned.size * floor;
    let changed = false;
    for (const i of flexIndices) {
      const proposed = flexWeight > 0 ? (weights[i] / flexWeight) * flexSpace : flexSpace / flexIndices.length;
      if (proposed < floor) {
        pinned.add(i);
        widths[i] = floor;
        changed = true;
      } else {
        widths[i] = proposed;
      }
    }
    if (!changed) break;
  }
  return widths;
}

export function intensityLayout(
  steps: WorkoutSegment[],
  totalWidth: number,
  options: IntensityLayoutOptions = {},
): IntensityBar[] {
  const items = intensitySteps(steps);
  if (!items.length || !(totalWidth > 0)) return [];

  const requestedGap = options.gap ?? 2;
  const requestedMin = options.minWidth ?? 4;
  // Crowded strips (e.g. 30×200 m) give up the gap before they give up bars.
  const gap = items.length * requestedMin + requestedGap * (items.length - 1) > totalWidth ? 0 : requestedGap;
  const available = Math.max(0, totalWidth - gap * (items.length - 1));

  const weights = items.map(stepWeightMeters);
  const widths = distribute(weights, available, requestedMin);

  let x = 0;
  return items.map((step, index) => {
    const bar = { step, x, width: widths[index] };
    x += widths[index] + gap;
    return bar;
  });
}
