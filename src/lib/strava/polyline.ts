/**
 * Decode Google's encoded-polyline format, which is what Strava's activity list
 * returns as `map.summary_polyline`.
 *
 * Why this exists: the /athlete/activities list already carries the whole route
 * for every run, and the sync was reading it only as a boolean
 * (`has_polyline: !!a.map?.summary_polyline`) and throwing the geometry away.
 * Recovering it costs nothing — no extra request, so no rate-limit budget — and
 * it works on a run of any age, unlike the streams endpoint, which the sync
 * only calls for the newest 15 runs under 45 days old.
 *
 * The trace is decimated: a few hundred points where the streams endpoint gives
 * thousands, and with no time or elevation. That is plenty to draw the route on
 * a map, and not enough for the pace-coloured segments on the detail screen, so
 * streams stay the richer path for recent runs — this never overwrites them.
 *
 * Format: latitude then longitude, each as a signed offset from the previous
 * point in units of 1e-5 degrees, zig-zag encoded into 5-bit groups, each group
 * offset by 63 into printable ASCII, with bit 0x20 set on every group but the
 * last.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Points from an encoded polyline, or `[]` when the input is empty, malformed or
 * decodes to coordinates outside the valid range.
 *
 * Returns `[]` rather than throwing: this runs inside the sync loop over every
 * activity, and one athlete's corrupt polyline must not abort the whole sync.
 * A partial decode is discarded for the same reason a half-written route is
 * worse than none — it would draw a run that stops halfway.
 */
export function decodePolyline(encoded: string | null | undefined): LatLng[] {
  if (!encoded) return [];

  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    // Latitude offset.
    do {
      if (index >= encoded.length) return []; // varint runs off the end
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0) return []; // character below the printable window
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (shift > 30) return []; // more groups than a 32-bit offset can hold
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    // Longitude offset.
    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0) return [];
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (shift > 30) return [];
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    const point = { lat: lat / 1e5, lng: lng / 1e5 };
    // A decode that drifts out of range means the stream was misaligned, and
    // every point after it is wrong too.
    if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
      return [];
    }
    points.push(point);
  }

  return points;
}

/**
 * The route for one activity as the sync should store it: the decoded summary
 * polyline, or `null` when there is nothing worth drawing.
 *
 * A single point is treated as nothing. Strava reports one for a treadmill run
 * that picked up a stray GPS fix, and `has_polyline` is what the UI uses to
 * decide whether to give the card a map area at all — promising a route and then
 * rendering a dot is worse than showing no map.
 */
export function routeFromSummaryPolyline(
  summary: string | null | undefined,
): LatLng[] | null {
  const points = decodePolyline(summary);
  return points.length > 1 ? points : null;
}
