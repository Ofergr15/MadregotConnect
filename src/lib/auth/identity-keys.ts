import { clearPersistedSWRCache } from '@/lib/swr-persist';
import { LEGACY_DASHBOARD_SYNC_PREFIX, STRAVA_OPEN_SYNC_PREFIX } from '@/lib/providers/open-sync';

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

/**
 * Identity keys whose name ends in an athlete id, so the exact key cannot be
 * listed above.
 *
 * The list above carries 'dashboard_synced' — but what the dashboard actually
 * wrote was `dashboard_synced:<athleteId>`, so signing out never removed it and
 * the entry has been decorative since the suffix was added. That is the same
 * drift this whole file exists to stop, one level down: a name in a list nobody
 * checks against the name being written. Matching by prefix means a per-athlete
 * key is covered the day it is introduced.
 */
export const IDENTITY_KEY_PREFIXES = [
  LEGACY_DASHBOARD_SYNC_PREFIX,
  STRAVA_OPEN_SYNC_PREFIX,
] as const;

/**
 * Which of the keys currently in storage this sign-out should remove.
 *
 * Pure and exported so the prefix half is testable: reading localStorage's own
 * enumeration needs a far more faithful stub than the three-method object the
 * rest of these tests get by with, and the interesting question — which names
 * match — has nothing to do with the browser.
 */
export function identityKeysToRemove(storedKeys: readonly string[]): string[] {
  return storedKeys.filter((key) =>
    IDENTITY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

/** Remove every identity key. No-op on the server. */
export function clearIdentityKeys() {
  if (typeof window === 'undefined') return;
  for (const key of IDENTITY_KEYS) {
    localStorage.removeItem(key);
  }
  // Object.keys rather than the length/key(i) pair because removing as we walk
  // would renumber the indexes underneath us. Wrapped because enumerating
  // storage is the one part of this that a private-mode or quota-exhausted
  // browser can refuse, and losing a per-athlete stamp must not be able to stop
  // a sign-out from finishing.
  try {
    for (const key of identityKeysToRemove(Object.keys(localStorage))) {
      localStorage.removeItem(key);
    }
  } catch { /* storage refused enumeration — the named keys above still went */ }
  // The persistent SWR cache holds this person's actual club data (runs, paces,
  // the feed they could see) and is scoped by the two keys above — so it has to go
  // with them, and it has to go here rather than in signOutEverywhere: this
  // function is also what clearLocalIdentity() calls before a new Strava/Google
  // sign-in, which is the path where the next person on the device would otherwise
  // be the first to see the last person's numbers.
  clearPersistedSWRCache();
}
