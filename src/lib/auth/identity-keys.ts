// Every localStorage key that says "who is signed in" in this browser.
//
// Two places wipe identity — clearLocalIdentity() before a new
// Strava/Google/Apple sign-in, and the Header's logout — and they had each
// hand-rolled their own list, which drifted: logout removed 'admin_session' and
// 'view_as_role', clearLocalIdentity did not. So signing in as an athlete on a
// browser that had once been the admin left admin_session === 'true' behind, and
// the athlete rendered with staff UI (e.g. the program page's isAdmin is
// `admin_session === 'true' || !!coach_email`). Both now iterate this array, so
// adding an identity key here is enough to have it cleared everywhere.
export const IDENTITY_KEYS = [
  'athlete_id',
  'athlete_name',
  'athlete_email',
  'athlete_group_id',
  'coach_email',
  // Elevated state. Stale values here grant the next user UI they shouldn't see.
  'admin_session',
  'view_as_role',
  // Per-identity remembered state — harmless to lose, wrong to inherit.
  'view_group',
  'garmin_ticket',
  'dashboard_synced',
  'dashboard_synced_with_garmin',
] as const;

/** Remove every identity key. No-op on the server. */
export function clearIdentityKeys() {
  if (typeof window === 'undefined') return;
  for (const key of IDENTITY_KEYS) {
    localStorage.removeItem(key);
  }
}
