/**
 * Heart-rate → color for the laps table. Effort is relative to the run itself
 * (its lowest and highest lap HR), so an easy day and a track session each
 * span the full green → yellow → red range instead of sharing absolute zones
 * we do not know per athlete.
 */

export interface EffortScale {
  lo: number;
  hi: number;
}

/** Below this HR spread the run is flat and every lap stays neutral. */
export const MIN_EFFORT_SPREAD = 8;

export function effortScale(heartRates: Array<number | null | undefined>): EffortScale | null {
  const values = heartRates.filter((hr): hr is number => typeof hr === 'number' && hr > 0);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi - lo >= MIN_EFFORT_SPREAD ? { lo, hi } : null;
}

/** 0 = easiest lap of the run, 1 = hardest. */
export function effortLevel(hr: number, scale: EffortScale): number {
  return Math.min(1, Math.max(0, (hr - scale.lo) / (scale.hi - scale.lo)));
}

/**
 * Green (140°) through yellow (~55°) to red (0°). Kept fairly light so it
 * reads on the card's navy background.
 */
export function effortColor(level: number): string {
  const hue = Math.round(140 * (1 - level));
  return `hsl(${hue} 85% 62%)`;
}

export function effortColorForHr(
  hr: number | null | undefined,
  scale: EffortScale | null,
): string | null {
  if (!scale || typeof hr !== 'number' || hr <= 0) return null;
  return effortColor(effortLevel(hr, scale));
}
