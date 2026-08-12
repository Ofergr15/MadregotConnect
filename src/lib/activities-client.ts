'use client';

// Client helper for the activities feed GET. The endpoint scopes results
// server-side: a non-staff caller gets ONLY their own athlete's rows (closing
// the prior leak where every phone downloaded the whole club's names/HR/GPS).
// We pass the caller's athleteId + their email header so the server can verify
// coach/admin status (never trusted from the client) and return the full roster
// only for real staff.
export function fetchActivities(): Promise<Response> {
  const athleteId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const email =
    typeof window !== 'undefined'
      ? localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || ''
      : '';
  const qs = athleteId ? `?athleteId=${encodeURIComponent(athleteId)}` : '';
  return fetch(`/api/activities${qs}`, {
    headers: email ? { 'x-user-email': email } : {},
  });
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
