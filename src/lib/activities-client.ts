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
export async function fetchActivities(
  options: { includeGps?: boolean; limit?: number } = {},
): Promise<Response> {
  const athleteId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const params = new URLSearchParams();
  if (athleteId) params.set('athleteId', athleteId);
  if (options.includeGps) params.set('include', 'gps');
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return fetch(`/api/activities${qs ? `?${qs}` : ''}`, {
    headers: await apiHeaders(),
  });
}

/** How one activity's distance compares to that day's planned target (see ActivitySyncEditor). */
export function fetchPlanMatch(activityId: string): Promise<Response> {
  return fetch(`/api/activities/${encodeURIComponent(activityId)}/plan-match`);
}

/** Fetch route/splits for one activity (DB uuid preferred). */
export async function fetchActivityDetails(activityId: number | string, athleteId: string): Promise<Response> {
  return fetch(
    `/api/activities/details?activityId=${encodeURIComponent(String(activityId))}&athleteId=${encodeURIComponent(athleteId)}`,
    { headers: await apiHeaders() },
  );
}
