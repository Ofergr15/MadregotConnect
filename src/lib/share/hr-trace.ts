/**
 * THE WATCH'S OWN HEART RATE, THINNED FOR THE SHARE CARD'S LAP CHART.
 *
 * The chart drew heart rate as one smooth curve through each lap's average, and
 * next to Strava's it read as too round to be real (feedback 2026-09-29): a lap's
 * average has none of the climb inside an interval or the drop in the rest after
 * it. The per-second trace does. A second-by-second line is ~3,000 points for an
 * hour, far finer than the card's ~1,000 pixels, so it is cut into equal stretches
 * of distance (the chart's x axis is metres) and each keeps its mean.
 *
 * Returns [metres from the start, bpm] pairs; null samples and zeros (a strap
 * losing contact) are skipped, and a stretch with nothing left is left out.
 */
export type HrTrace = Array<[number, number]>;

export function thinHrTrace(d: number[], hr: Array<number | null> | undefined, bins = 240): HrTrace {
  if (!hr || hr.length !== d.length || d.length < 2) return [];
  const d0 = d[0]!;
  const span = d[d.length - 1]! - d0;
  if (!(span > 0)) return [];
  const sums = new Array<number>(bins).fill(0);
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < d.length; i++) {
    const v = hr[i];
    if (v == null || !(v > 0)) continue;
    const b = Math.min(bins - 1, Math.floor(((d[i]! - d0) / span) * bins));
    sums[b]! += v;
    counts[b]! += 1;
  }
  const out: HrTrace = [];
  for (let b = 0; b < bins; b++) {
    if (counts[b]) out.push([Math.round(((b + 0.5) / bins) * span), Math.round(sums[b]! / counts[b]!)]);
  }
  return out;
}
