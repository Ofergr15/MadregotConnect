/**
 * START/FINISH PRIVACY ZONE — every route shown to anyone other than the runner
 * and staff loses its first and last 200 m (Ofer, 2026-11-21, settings rev 3 Q2).
 *
 * Done on the server, in the projection and the detail routes, so the full trace
 * never reaches another member's device: the start and end of a run are usually
 * someone's front door. Distances are along the track (haversine), not from the
 * endpoints, so a loop that finishes where it started loses both ends properly.
 *
 * A route of 400 m or less trims to nothing (null) — there is no middle to show.
 */
export const ROUTE_TRIM_M = 200;

export type LatLng = { lat: number; lng: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drops every point within `m` metres (along the track) of either end. */
export function trimRouteEnds<P extends LatLng>(points: P[] | null | undefined, m = ROUTE_TRIM_M): P[] | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  if (total <= 2 * m) return null;
  const kept = points.filter((_, i) => cum[i] > m && cum[i] < total - m);
  return kept.length > 1 ? kept : null;
}

/** Whether this viewer sees the whole trace: the runner themselves, or staff. */
export function seesFullRoute(
  viewer: { athleteId: string | null; isStaff: boolean; isSuperUser?: boolean },
  ownerAthleteId: string | null | undefined,
): boolean {
  if (viewer.isStaff || viewer.isSuperUser) return true;
  return !!ownerAthleteId && viewer.athleteId === ownerAthleteId;
}

/** The route as this viewer may see it. */
export function routeForViewer<P extends LatLng>(
  points: P[] | null | undefined,
  viewer: { athleteId: string | null; isStaff: boolean; isSuperUser?: boolean },
  ownerAthleteId: string | null | undefined,
): P[] | null {
  if (!Array.isArray(points)) return null;
  return seesFullRoute(viewer, ownerAthleteId) ? points : trimRouteEnds(points);
}
