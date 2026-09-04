'use client';

import { apiHeaders } from '@/lib/api';

// Client helper for the activities feed GET. The endpoint scopes results
// server-side: a non-staff caller gets ONLY their own athlete's rows (closing
// the prior leak where every phone downloaded the whole club's names/HR/GPS).
// We pass the caller's athleteId; the server derives coach/admin status from the
// bearer token and returns the full roster only for real staff. The athleteId in
// the query string is no longer a claim of identity — the server checks it
// against the session, so passing somebody else's now 403s instead of returning
// their runs.
//
// `gps_points` (full per-run GPS trace, ~30-60KB/row) is left out of the list
// response by default — pass `includeGps: true` only for callers that render
// the route straight from the list (e.g. ActivityFeed's stored-route
// preference) without a follow-up /api/activities/details fetch.
//
// `limit` (1..200, default 200) caps how many rows come back. Rows carry `splits`
// and `laps` JSONB, so ask for a small one when you only need the newest few — or
// just to know whether the athlete has any activities at all.
//
// `selfOnly` is what a PERSONAL screen wants: the server hands staff the whole
// club even when we name an athlete, so a coach who also runs would otherwise get
// other people's activities back and have to filter them out client-side — and
// their own runs would have to be inside the newest `limit` rows club-wide to
// survive that filter. Pass it whenever the answer is about the signed-in athlete
// ("do I have any runs", "what did I do this week"); leave it off for the club
// feed and leaderboards, which want everyone.
export async function fetchActivities(
  options: { includeGps?: boolean; limit?: number; selfOnly?: boolean } = {},
): Promise<Response> {
  const athleteId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const params = new URLSearchParams();
  if (athleteId) params.set('athleteId', athleteId);
  if (options.includeGps) params.set('include', 'gps');
  if (options.limit) params.set('limit', String(options.limit));
  if (options.selfOnly) params.set('scope', 'self');
  const qs = params.toString();
  return fetch(`/api/activities${qs ? `?${qs}` : ''}`, {
    headers: await apiHeaders(),
  });
}

/** How one activity's distance compares to that day's planned target (see ActivitySyncEditor). */
export function fetchPlanMatch(activityId: string): Promise<Response> {
  return fetch(`/api/activities/${encodeURIComponent(activityId)}/plan-match`);
}

/**
 * Fetch route/splits/summary for one activity (DB uuid preferred).
 *
 * `athleteId` is optional: the detail page reached from a feed card knows only
 * the activity id. Pass it when you have it — it narrows the lookup, which is
 * how a legacy numeric garmin/strava id stays unambiguous between athletes.
 */
export async function fetchActivityDetails(
  activityId: number | string,
  athleteId?: string | null,
): Promise<Response> {
  const params = new URLSearchParams({ activityId: String(activityId) });
  if (athleteId) params.set('athleteId', athleteId);
  return fetch(`/api/activities/details?${params.toString()}`, {
    headers: await apiHeaders(),
  });
}
