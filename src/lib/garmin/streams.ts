/**
 * The per-sample time series inside Garmin's `/activity/{id}/details` response.
 *
 * We have been paying for this on every sync since the beginning and keeping only
 * the map polyline out of it (`getActivityGpsPoints`). Everything needed to answer
 * "did they run the session" is in the part we discarded: a ~1 Hz trace of
 * cumulative distance, speed, heart rate and cadence.
 *
 * Why it matters more than laps: laps are whatever the watch happened to mark. An
 * athlete with 1 km auto-lap who runs 8x15s strides leaves no lap trace of them at
 * all, and a plan that says "2 km easy, then 20 km at 4:25" cannot be graded from
 * a whole-run average — the warm-up and the strides drag it 10 s/km off. With the
 * trace, both are answerable: the plan's blocks are ranges of the distance axis,
 * and a rep is a run of samples above a pace threshold.
 *
 * Shape on the way out is COLUMNAR (`{ t: [...], d: [...] }`, not
 * `[{ t, d }, ...]`): one array per metric, integers only. A 90-minute run is
 * ~5400 samples, and the columnar form of small integers is roughly a third of
 * the size of an array of objects and compresses far better in Postgres TOAST.
 */

/** Metric arrays are parallel and index-aligned; a metric absent from the
 *  response is simply absent here rather than an array of nulls. */
export interface ActivityStream {
  /** Seconds since the start of the activity. Monotonic, may have gaps (pauses). */
  t: number[];
  /** Cumulative metres. Monotonic. */
  d: number[];
  /** Speed in cm/s — an integer, and unlike pace it has a finite value (0) while
   *  standing still, which matters because a walk-recovery sample would otherwise
   *  be Infinity. `paceAt` converts. */
  v?: number[];
  /** Heart rate, bpm. */
  hr?: number[];
  /** Cadence, steps per minute (both feet). */
  cad?: number[];
  /** Elevation, metres. */
  elev?: number[];
}

export interface ParsedStream {
  series: ActivityStream;
  sampleCount: number;
  /** Median seconds between samples. ~1 on a modern watch; large values mean the
   *  response was downsampled and short reps cannot be resolved from it. */
  intervalSec: number;
  /** Which optional metrics came back, for callers that want to check before use. */
  metrics: string[];
  /** Set when the distance axis had to be rescaled — see `expectedDistanceM`. */
  unitCorrection?: string;
}

/** Garmin unit keys → metres. The API is unofficial; `sumDistance` has been seen
 *  reported in both metres and kilometres, so the descriptor's unit is read
 *  rather than assumed. */
const DISTANCE_TO_M: Record<string, number> = {
  meter: 1, metre: 1, m: 1,
  kilometer: 1000, kilometre: 1000, km: 1000,
  mile: 1609.344, statutemile: 1609.344, mi: 1609.344,
  foot: 0.3048, feet: 0.3048, yard: 0.9144,
};

/** Garmin unit keys → metres per second. */
const SPEED_TO_MPS: Record<string, number> = {
  mps: 1, meterpersecond: 1, metrepersecond: 1,
  kph: 1 / 3.6, kilometerperhour: 1 / 3.6, kmh: 1 / 3.6,
  mph: 0.44704, mileperhour: 0.44704,
};

/** Garmin unit keys → seconds. */
const TIME_TO_S: Record<string, number> = {
  second: 1, s: 1, sec: 1,
  millisecond: 0.001, ms: 0.001,
  minute: 60, hour: 3600,
};

interface Descriptor { index: number; factor: number }

/**
 * Locate a metric by key and work out the multiplier that brings it to our unit.
 * Unknown or missing units fall back to `fallbackFactor` rather than dropping the
 * metric: a series in the wrong unit is caught by the `expectedDistanceM` check
 * below, whereas a missing series silently costs every verdict its evidence.
 */
function descriptor(
  descriptors: any[],
  keys: string[],
  table: Record<string, number> | null,
  fallbackFactor = 1,
): Descriptor | null {
  for (const key of keys) {
    const found = descriptors.findIndex((m: any) => m?.key === key);
    if (found < 0) continue;
    const index = descriptors[found]?.metricsIndex ?? found;
    if (!table) return { index, factor: fallbackFactor };
    const unitKey = String(descriptors[found]?.unit?.key || '').toLowerCase();
    return { index, factor: table[unitKey] ?? fallbackFactor };
  }
  return null;
}

const median = (nums: number[]) => {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Parse the details payload into a compact stream, or null when there is nothing
 * usable (an indoor activity with no distance axis, a response without metrics, a
 * payload from an older Garmin shape).
 *
 * `expectedDistanceM` is the distance the activity itself reports. It is used only
 * as a unit sanity check: an unofficial API that silently switches `sumDistance`
 * from metres to kilometres would otherwise turn every pace in the trace into
 * nonsense, and a 1000x error is unmistakable.
 */
export function parseActivityStream(details: any, expectedDistanceM?: number): ParsedStream | null {
  const descriptors = details?.metricDescriptors;
  const rows = details?.activityDetailMetrics;
  if (!Array.isArray(descriptors) || !Array.isArray(rows) || rows.length < 2) return null;

  const dist = descriptor(descriptors, ['sumDistance'], DISTANCE_TO_M, 1);
  if (!dist) return null;
  // Elapsed-duration is the axis we want (seconds from the start). directTimestamp
  // is epoch ms and needs the first sample subtracted; it is the fallback because
  // some responses carry it and not the sum.
  const elapsed = descriptor(descriptors, ['sumElapsedDuration', 'sumDuration'], TIME_TO_S, 1);
  const stamp = descriptor(descriptors, ['directTimestamp'], null, 0.001);
  if (!elapsed && !stamp) return null;

  const speed = descriptor(descriptors, ['directSpeed', 'directVerticalSpeed'], SPEED_TO_MPS, 1);
  const hr = descriptor(descriptors, ['directHeartRate'], null);
  const cad = descriptor(descriptors, ['directDoubleCadence', 'directRunCadence'], null);
  const elev = descriptor(descriptors, ['directElevation'], DISTANCE_TO_M, 1);

  // Read first, round later. The unit sanity check below compares the distance axis
  // against the activity's own total, and a payload reporting kilometres in a field
  // labelled metres carries values like 0.0033 — rounding those to integers first
  // zeroes the axis and destroys the very evidence the check needs.
  interface Raw { s: number; m: number; v: number; hr: number; cad: number; elev: number }
  const raw: Raw[] = [];
  let t0: number | null = null;

  for (const row of rows) {
    const vals = row?.metrics;
    if (!Array.isArray(vals)) continue;

    const rawDist = vals[dist.index];
    if (rawDist == null) continue;
    let seconds: number | null = null;
    if (elapsed) {
      const value = vals[elapsed.index];
      if (value != null) seconds = value * elapsed.factor;
    }
    if (seconds == null && stamp) {
      const value = vals[stamp.index];
      if (value != null) {
        const ms = value * stamp.factor;
        if (t0 == null) t0 = ms;
        seconds = ms - t0;
      }
    }
    if (seconds == null) continue;

    raw.push({
      s: seconds,
      m: rawDist * dist.factor,
      v: speed ? Math.max(0, (vals[speed.index] ?? 0) * speed.factor) : 0,
      hr: hr ? (vals[hr.index] ?? 0) : 0,
      cad: cad ? (vals[cad.index] ?? 0) : 0,
      elev: elev ? (vals[elev.index] ?? 0) : 0,
    });
  }
  if (raw.length < 2) return null;

  // Unit sanity check. Only a factor-of-1000 slip is corrected: that is a unit
  // mistake and nothing else, whereas a 5% discrepancy is normal (the trace stops
  // at the last sample, the summary distance is the watch's own total). The axis
  // maximum rather than the last sample, so one glitched final reading can't decide
  // it. Applied to the distance axis only — speed carries its own unit.
  let unitCorrection: string | undefined;
  const rawTotal = raw.reduce((max, r) => (r.m > max ? r.m : max), 0);
  if (expectedDistanceM && expectedDistanceM > 100 && rawTotal > 0) {
    const ratio = rawTotal / expectedDistanceM;
    const rescale = ratio > 500 && ratio < 2000 ? 1 / 1000
      : ratio > 1 / 2000 && ratio < 1 / 500 ? 1000
        : null;
    if (rescale) {
      for (const r of raw) r.m *= rescale;
      unitCorrection = `distance x${rescale}`;
    }
  }

  const t: number[] = [];
  const d: number[] = [];
  const v: number[] = [];
  const hrs: number[] = [];
  const cads: number[] = [];
  const elevs: number[] = [];
  let lastT = -Infinity;
  let lastD = 0;

  for (const r of raw) {
    // Time must strictly advance and distance must never go backwards.
    //
    // Strictly, because two samples sharing a timestamp are a watch re-reporting
    // one after a pause: keeping both makes a segment of zero duration and positive
    // distance, and a rep detector dividing by it gets an infinite speed. Distance
    // is allowed to stand still — that is a walk break, and dropping those samples
    // would erase the break from the axis and make a recovery look instant.
    if (r.s <= lastT || r.m < lastD) continue;
    lastT = r.s;
    lastD = r.m;

    t.push(Math.round(r.s));
    d.push(Math.round(r.m));
    if (speed) v.push(Math.round(r.v * 100));
    if (hr) hrs.push(Math.round(r.hr));
    if (cad) cads.push(Math.round(r.cad));
    if (elev) elevs.push(Math.round(r.elev));
  }

  if (t.length < 2) return null;

  const series: ActivityStream = { t, d };
  const metrics = ['t', 'd'];
  if (speed && v.length === t.length) { series.v = v; metrics.push('v'); }
  if (hr && hrs.length === t.length) { series.hr = hrs; metrics.push('hr'); }
  if (cad && cads.length === t.length) { series.cad = cads; metrics.push('cad'); }
  if (elev && elevs.length === t.length) { series.elev = elevs; metrics.push('elev'); }

  return {
    series,
    sampleCount: t.length,
    intervalSec: median(t.slice(1).map((x, i) => x - t[i])),
    metrics,
    ...(unitCorrection ? { unitCorrection } : {}),
  };
}

/** The map polyline, from the same payload — so a sync needs one details call and
 *  not two. Mirrors the lat/lng fallback the activity-details route already uses. */
export function polylineFromDetails(details: any): Array<{ lat: number; lng: number }> {
  const poly = details?.geoPolylineDTO?.polyline;
  if (Array.isArray(poly)) {
    const points = poly
      .filter((p: any) => p?.lat != null && p?.lon != null)
      .map((p: any) => ({ lat: p.lat, lng: p.lon }));
    if (points.length) return points;
  }
  const descriptors = details?.metricDescriptors;
  const rows = details?.activityDetailMetrics;
  if (!Array.isArray(descriptors) || !Array.isArray(rows)) return [];
  const lat = descriptor(descriptors, ['directLatitude'], null);
  const lng = descriptor(descriptors, ['directLongitude'], null);
  if (!lat || !lng) return [];
  const points: Array<{ lat: number; lng: number }> = [];
  for (const row of rows) {
    const vals = row?.metrics;
    if (!Array.isArray(vals)) continue;
    const a = vals[lat.index];
    const b = vals[lng.index];
    if (a != null && b != null && a !== 0) points.push({ lat: a, lng: b });
  }
  return points;
}

/** Pace in s/km at sample `i`, or null while stopped. */
export function paceAt(series: ActivityStream, i: number): number | null {
  const cmps = series.v?.[i];
  if (cmps == null) return null;
  if (cmps < 20) return null; // under 0.2 m/s is standing, not a pace
  return Math.round(100000 / cmps);
}

/**
 * Average pace (s/km) over the samples covering `[fromM, toM)` of the distance
 * axis, computed from time and distance rather than by averaging sample paces —
 * averaging pace over-weights the slow samples and would flatter a walk break.
 * Returns null when the window holds less than 50 m.
 */
export function paceOverDistance(series: ActivityStream, fromM: number, toM: number): number | null {
  const { t, d } = series;
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < d.length; i++) {
    if (startIdx < 0 && d[i] >= fromM) startIdx = i;
    if (d[i] <= toM) endIdx = i;
  }
  if (startIdx < 0 || endIdx <= startIdx) return null;
  const metres = d[endIdx] - d[startIdx];
  const seconds = t[endIdx] - t[startIdx];
  if (metres < 50 || seconds <= 0) return null;
  return Math.round(seconds / (metres / 1000));
}
