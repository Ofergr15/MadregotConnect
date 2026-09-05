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
//
// `volumeOnly` asks for four columns — id, athlete_id, start_time, distance —
// instead of all 32. For a caller that only totals kilometres per week that is
// the whole answer, and `limit` is no substitute: it caps ROWS, so the wide
// columns (`splits`, `laps`) still come down for each one. Measured on the feed's
// weekly-volume card: 113 KB / 5.2 s for the full shape.
//
// `sinceDays` is a start_time floor expressed in days back, and `since`/`until`
// are explicit YYYY-MM-DD bounds (`until` exclusive) for a caller that wants one
// named window rather than a count. A row count can't express either: how far
// back 200 rows reaches depends entirely on how often the athlete runs, so the
// oldest weeks silently fall off a twelve-week chart for anyone with high
// mileage, and a screen showing one PAST week may not find that week at all.
export async function fetchActivities(
  options: {
    includeGps?: boolean;
    limit?: number;
    selfOnly?: boolean;
    volumeOnly?: boolean;
    sinceDays?: number;
    since?: string;
    until?: string;
  } = {},
): Promise<Response> {
  const athleteId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const params = new URLSearchParams();
  if (athleteId) params.set('athleteId', athleteId);
  if (options.includeGps) params.set('include', 'gps');
  if (options.limit) params.set('limit', String(options.limit));
  if (options.selfOnly) params.set('scope', 'self');
  if (options.volumeOnly) params.set('shape', 'volume');
  if (options.sinceDays) {
    // Date-only (YYYY-MM-DD), not a full timestamp: start_time is stored as the
    // athlete's wall clock, so a UTC instant here would shift the boundary a few
    // hours and is precision this floor doesn't have anyway.
    const floor = new Date(Date.now() - options.sinceDays * 86400_000);
    params.set('since', floor.toISOString().slice(0, 10));
  }
  if (options.since) params.set('since', options.since);
  if (options.until) params.set('until', options.until);
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
