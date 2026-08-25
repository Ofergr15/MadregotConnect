'use client';

// Client helper for the activities feed GET. The endpoint scopes results
// server-side: a non-staff caller gets ONLY their own athlete's rows (closing
// the prior leak where every phone downloaded the whole club's names/HR/GPS).
// We pass the caller's athleteId + their email header so the server can verify
// coach/admin status (never trusted from the client) and return the full roster
// only for real staff.
//
// `gps_points` (full per-run GPS trace, ~30-60KB/row) is left out of the list
// response by default — pass `includeGps: true` only for callers that render
// the route straight from the list (e.g. ActivityFeed's stored-route
// preference) without a follow-up /api/activities/details fetch.
export function fetchActivities(options: { includeGps?: boolean } = {}): Promise<Response> {
  const athleteId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const email =
    typeof window !== 'undefined'
      ? localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || ''
      : '';
  const params = new URLSearchParams();
  if (athleteId) params.set('athleteId', athleteId);
  if (options.includeGps) params.set('include', 'gps');
  const qs = params.toString();
  return fetch(`/api/activities${qs ? `?${qs}` : ''}`, {
    headers: email ? { 'x-user-email': email } : {},
  });
}

/** How one activity's distance compares to that day's planned target (see ActivitySyncEditor). */
export function fetchPlanMatch(activityId: string): Promise<Response> {
  return fetch(`/api/activities/${encodeURIComponent(activityId)}/plan-match`);
}

/** Fetch route/splits for one activity (DB uuid preferred). */
export function fetchActivityDetails(activityId: number | string, athleteId: string): Promise<Response> {
  const email =
    typeof window !== 'undefined'
      ? localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || ''
      : '';
  return fetch(
    `/api/activities/details?activityId=${encodeURIComponent(String(activityId))}&athleteId=${encodeURIComponent(athleteId)}`,
    { headers: email ? { 'x-user-email': email } : {} },
  );
}
