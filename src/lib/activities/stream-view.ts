/**
 * What the run page draws from the 1 Hz Garmin trace (`activity_streams`).
 *
 * Until now the phone never saw the trace: every chart was the per-km splits, so an
 * 8 km run was 8 dots joined by a spline whose peaks the spline invented, and a
 * lap-pressed workout's "kilometres" were the lap average copied into each one (five
 * identical 3:51 rows for a 5 km rep). Three readings of the trace fix both:
 *
 *  - `streamView`: the trace re-sampled onto an even DISTANCE grid of ~400 points,
 *    the x-axis every chart on the page shares. Pace per bin is time over distance,
 *    not an average of speeds, so a bin that straddles a stop reads slow instead of
 *    averaging a 0 cm/s sample into nonsense.
 *  - `streamKmSplits`: true kilometres, cut where the trace crosses each 1,000 m.
 *  - `streamHrZones`: seconds in each zone, against the same thresholds as `getHRZone`.
 *
 * Pure, and unit-tested; the route only loads and gates.
 *
 * Units out: distance KM on the chart axis (metres in the splits), time SECONDS,
 * pace SECONDS PER KM, elevation METRES, cadence STEPS PER MINUTE (both feet).
 */

import type { ActivityStream } from '@/lib/garmin/streams';

export interface StreamView {
  /** Cumulative distance at the END of each bin, km. The shared x-axis. */
  d: number[];
  /** Elapsed seconds at the end of each bin. */
  t: number[];
  /** sec/km over the bin; null when the bin is effectively standing still. */
  pace: Array<number | null>;
  /** Absent when the trace has no HR, or the viewer may not see this runner's trace. */
  hr?: Array<number | null>;
  elev?: Array<number | null>;
  cad?: Array<number | null>;
}

export interface StreamKmSplit {
  /** 1-based kilometre number; the trailing partial keeps the next number. */
  km: number;
  /** Metres actually covered by this split (1000 except the last). */
  distance: number;
  duration: number;
  pace: number;
  hr: number | null;
  elevationGain: number;
  elevationLoss: number;
  cadence: number | null;
}

/** A bin slower than this is a stop, a walk to the car, a traffic light — not a pace to draw. */
const MAX_DRAWN_PACE = 15 * 60;
/** Trailing stretch shorter than this folds into the last kilometre — same rule as km-splits.ts. */
const MIN_TRAILING_METERS = 200;
/** Elevation changes under this between smoothed samples are GPS/baro jitter, not climbing. */
const ELEV_HYSTERESIS_M = 1;

function mean(values: Array<number | null | undefined> | undefined, from: number, to: number, skipZero = false): number | null {
  if (!values) return null;
  let s = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v) || (skipZero && v === 0)) continue;
    s += v;
    n++;
  }
  return n ? s / n : null;
}

const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const roundInt = (v: number | null) => (v == null ? null : Math.round(v));

/** Index ranges [start, end) of the samples that fall in each even-distance bin. */
function distanceBins(d: number[], bins: number): Array<[number, number]> {
  const total = d[d.length - 1] - d[0];
  const out: Array<[number, number]> = [];
  if (!(total > 0)) return out;
  const step = total / bins;
  let i = 0;
  for (let b = 1; b <= bins; b++) {
    const edge = b === bins ? Infinity : d[0] + step * b;
    const start = i;
    while (i < d.length && d[i] <= edge) i++;
    if (i > start) out.push([start, i]);
  }
  return out;
}

export function streamView(
  series: ActivityStream,
  { points = 400, includeHr = true }: { points?: number; includeHr?: boolean } = {},
): StreamView | null {
  const { t, d } = series;
  if (!Array.isArray(t) || !Array.isArray(d) || t.length < 2 || t.length !== d.length) return null;
  const bins = distanceBins(d, Math.min(points, t.length));
  if (bins.length < 2) return null;

  const view: StreamView = { d: [], t: [], pace: [] };
  const hasHr = includeHr && Array.isArray(series.hr) && series.hr.length === t.length && series.hr.some(v => v > 0);
  const hasElev = Array.isArray(series.elev) && series.elev.length === t.length;
  const hasCad = Array.isArray(series.cad) && series.cad.length === t.length && series.cad.some(v => v > 0);
  if (hasHr) view.hr = [];
  if (hasElev) view.elev = [];
  if (hasCad) view.cad = [];

  let prevD = d[0];
  let prevT = t[0];
  for (const [s, e] of bins) {
    const endD = d[e - 1];
    const endT = t[e - 1];
    const dd = endD - prevD;
    const dt = endT - prevT;
    const pace = dd > 0 ? dt / (dd / 1000) : null;
    view.d.push(Math.round(endD) / 1000);
    view.t.push(Math.round(endT));
    view.pace.push(pace != null && pace > 0 && pace <= MAX_DRAWN_PACE ? Math.round(pace) : null);
    if (view.hr) view.hr.push(roundInt(mean(series.hr, s, e, true)));
    if (view.elev) view.elev.push(round1(mean(series.elev, s, e)));
    if (view.cad) view.cad.push(roundInt(mean(series.cad, s, e, true)));
    prevD = endD;
    prevT = endT;
  }
  return view;
}

/** Climb and descent along a stretch, ignoring sub-metre wobble. */
function climb(elev: number[] | undefined, from: number, to: number): { gain: number; loss: number } {
  if (!elev) return { gain: 0, loss: 0 };
  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  for (let i = from; i < to; i++) {
    const v = elev[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (ref == null) { ref = v; continue; }
    const diff = v - ref;
    if (diff >= ELEV_HYSTERESIS_M) { gain += diff; ref = v; }
    else if (diff <= -ELEV_HYSTERESIS_M) { loss -= diff; ref = v; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export function streamKmSplits(series: ActivityStream): StreamKmSplit[] {
  const { t, d } = series;
  if (!Array.isArray(t) || !Array.isArray(d) || t.length < 2 || t.length !== d.length) return [];
  const total = d[d.length - 1];
  const out: StreamKmSplit[] = [];
  let start = 0;
  let km = 1;
  const push = (end: number) => {
    const startD = start === 0 ? 0 : d[start - 1];
    const startT = start === 0 ? 0 : t[start - 1];
    const distance = Math.round(d[end - 1] - startD);
    const duration = Math.round(t[end - 1] - startT);
    if (distance <= 0 || duration <= 0) return;
    const { gain, loss } = climb(series.elev, Math.max(0, start - 1), end);
    out.push({
      km,
      distance,
      duration,
      pace: Math.round(duration / (distance / 1000)),
      hr: roundInt(mean(series.hr, start, end, true)),
      elevationGain: gain,
      elevationLoss: loss,
      cadence: roundInt(mean(series.cad, start, end, true)),
    });
  };
  for (let i = 0; i < d.length; i++) {
    const remaining = total - km * 1000;
    if (d[i] >= km * 1000 && remaining >= MIN_TRAILING_METERS) {
      push(i + 1);
      start = i + 1;
      km++;
    }
  }
  if (start < d.length) push(d.length);
  return out;
}

/** Zone floors as fractions of max HR — kept identical to `getHRZone` in components/activity/format.ts. */
export const HR_ZONE_FLOORS = [0, 0.6, 0.7, 0.8, 0.9] as const;

/** Seconds spent in zones 1..5. Gaps over 10 s (pauses) count 1 s, not the whole gap. */
export function streamHrZones(series: ActivityStream, maxHr: number): number[] | null {
  const { t, hr } = series;
  if (!Array.isArray(hr) || hr.length !== t.length || !(maxHr > 0)) return null;
  const sec = [0, 0, 0, 0, 0];
  let any = false;
  for (let i = 1; i < t.length; i++) {
    const h = hr[i];
    if (!(h > 0)) continue;
    const dt = t[i] - t[i - 1];
    const step = dt > 0 && dt <= 10 ? dt : 1;
    const pct = h / maxHr;
    let z = 0;
    for (let k = HR_ZONE_FLOORS.length - 1; k >= 0; k--) if (pct >= HR_ZONE_FLOORS[k]) { z = k; break; }
    sec[z] += step;
    any = true;
  }
  return any ? sec.map(Math.round) : null;
}
