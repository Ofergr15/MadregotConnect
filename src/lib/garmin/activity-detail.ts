/**
 * Maps a Garmin activity-detail response onto the `athlete_activities`
 * enrichment columns.
 *
 * Why this exists: `gc.getActivity()` does NOT reliably populate the top-level
 * fields the sync used to read. Verified against production rows — every
 * `detail.<field>` read came back null (start_lat, location_name, vo2max,
 * lap_count, has_polyline) while every `detail.summaryDTO.<field>` read
 * populated fine (end_lat, avg_cadence, avg_stride_length, moving_duration).
 * The damage wasn't cosmetic: `has_polyline: false` suppressed the GPS fetch
 * entirely, so `gps_points` stayed empty, migration 047's `trg_route_preview`
 * trigger had nothing to downsample into `route_preview`, and NO map ever
 * rendered — not in the feed card, not in the post-workout editor sheet.
 *
 * So: never trust a single source. Read `summaryDTO` first, then the detail
 * root, then fall back to the activity LIST row, which does carry
 * startLatitude/locationName/lapCount/vO2MaxValue (see client.getActivities),
 * and finally to the polyline's own first/last point for coordinates.
 *
 * `hasPolyline` is deliberately NOT read from any of them — the caller fetches
 * the polyline unconditionally and `has_polyline` is derived from whether
 * points actually came back. A flag that claims "no GPS" is unfalsifiable; an
 * empty point array is a fact.
 */

/** The subset of an activity LIST row this mapper falls back to. */
export interface ActivityListFallback {
  startLatitude?: number | null;
  startLongitude?: number | null;
  endLatitude?: number | null;
  endLongitude?: number | null;
  averageRunningCadence?: number | null;
  avgStrideLength?: number | null;
  vO2MaxValue?: number | null;
  lapCount?: number | null;
  locationName?: string | null;
  movingDuration?: number | null;
}

export interface GpsPoint {
  lat: number;
  lng: number;
}

export interface ActivityEnrichment {
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  avg_cadence: number | null;
  avg_stride_length: number | null;
  vo2max: number | null;
  lap_count: number | null;
  location_name: string | null;
  moving_duration: number | null;
  perceived_rpe: number | null;
  perceived_feel: number | null;
  gps_points: GpsPoint[];
  has_polyline: boolean;
}

/**
 * First finite, non-zero candidate — or null. Zero counts as absent on purpose
 * for every field here: lat/lng 0 is the Gulf of Guinea (Garmin's "no fix"
 * placeholder, never a real run), and a 0 cadence / VO2max / lap count /
 * moving duration is equally meaningless. Preserves the `||` semantics the
 * sync always had, just across more sources.
 */
function pickNum(...candidates: Array<unknown>): number | null {
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

/** First non-empty string — or null. */
function pickStr(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c;
  }
  return null;
}

export function mapActivityDetail(
  detail: Record<string, any> | null | undefined,
  list: ActivityListFallback,
  gpsPoints: GpsPoint[] = [],
): ActivityEnrichment {
  const d = detail || {};
  const summ: Record<string, any> = d.summaryDTO || {};
  const first = gpsPoints.length > 0 ? gpsPoints[0] : null;
  const last = gpsPoints.length > 1 ? gpsPoints[gpsPoints.length - 1] : null;

  const strideMeters = pickNum(summ.strideLength, d.strideLength);
  const movingSeconds = pickNum(summ.movingDuration, d.movingDuration, list.movingDuration);

  return {
    start_lat: pickNum(summ.startLatitude, d.startLatitude, list.startLatitude, first?.lat),
    start_lng: pickNum(summ.startLongitude, d.startLongitude, list.startLongitude, first?.lng),
    end_lat: pickNum(summ.endLatitude, d.endLatitude, list.endLatitude, last?.lat),
    end_lng: pickNum(summ.endLongitude, d.endLongitude, list.endLongitude, last?.lng),
    avg_cadence: pickNum(summ.averageRunCadence, d.averageRunningCadenceInStepsPerMinute, list.averageRunningCadence),
    // Stored in centimetres. summaryDTO reports stride in metres; the list
    // row's avgStrideLength is already centimetres, so only the former scales.
    avg_stride_length: strideMeters != null ? Math.round(strideMeters * 100) : pickNum(list.avgStrideLength),
    vo2max: pickNum(summ.vO2MaxValue, d.vO2MaxValue, list.vO2MaxValue),
    lap_count: pickNum(summ.lapCount, d.lapCount, list.lapCount),
    location_name: pickStr(d.locationName, summ.locationName, list.locationName),
    moving_duration: movingSeconds != null ? Math.round(movingSeconds) : null,
    // Garmin "Self Evaluation" — only present when answered on-watch. Stored on
    // the scales the UI shows, not Garmin's internal 0-100.
    perceived_rpe: summ.directWorkoutRpe != null ? summ.directWorkoutRpe / 10 : null,
    perceived_feel: summ.directWorkoutFeel != null ? summ.directWorkoutFeel / 25 : null,
    gps_points: gpsPoints,
    // >1 point, not >0: a single fix can't draw a route, and both RouteMinimap
    // and lib/feed/project.ts's toRoute() already use that same threshold.
    has_polyline: gpsPoints.length > 1,
  };
}
